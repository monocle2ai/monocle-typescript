import { context } from "@opentelemetry/api";
import { INFERENCE_TOOL_CALL, INFERENCE_TURN_END, MONOCLE_ACTIVE_SPAN_KEY, SCOPE_AGENTIC_INVOCATION, WORKFLOW_TYPE_GENERIC, WORKFLOW_TYPE_KEY_SYMBOL, WrapperArguments } from "../../../common/constants";
import { NonFrameworkSpanHandler } from "../../../common/spanHandler";
import { getOpenAgentInvocation } from "../../../common/agenticInvocation";
import { updateBaggageContextWithScopes } from "../../../common/utils";
import { Span } from "../../../common/opentelemetryUtils";
import { getExceptionMessage, getStatus, getStatusCode } from "../../utils";
import { mapOpenaiFinishReasonToFinishType } from "../../finishType";


// The Responses API has no finish_reason and reports status "completed" for a
// tool call just as for text, so the signal has to come off output[].
function emittedToolCall(response: any): boolean {
    if (Array.isArray(response?.output)
        && response.output.some((item: any) =>
            item?.type === "function_call" || item?.type === "custom_tool_call")) {
        return true;
    }
    return Boolean(response?.choices?.[0]?.message?.tool_calls?.length);
}

function extractFinishReason(response: any): string | null {
    try {
        // Handle traditional chat.completions.create() format
        if (response && response.choices && response.choices[0] && response.choices[0].finish_reason) {
            return response.choices[0].finish_reason;
        }

        // Check what was emitted before falling back to the status mapping.
        if (emittedToolCall(response)) {
            return "tool_calls";
        }

        // Handle new responses.create() format
        if (response && response.status) {
            // Map status to equivalent finish_reason
            switch (response.status) {
                case "completed":
                    return "stop";
                case "incomplete":
                    return "length"; // Likely truncated due to token limit
                case "failed":
                    return "error";
                default:
                    return response.status; // Return the status as-is
            }
        }

        // Handle streaming responses where individual chunks might have status
        if (response && response.output && Array.isArray(response.output) && response.output[0] && response.output[0].status) {
            switch (response.output[0].status) {
                case "completed":
                    return "stop";
                case "incomplete":
                    return "length";
                case "failed":
                    return "error";
                default:
                    return response.output[0].status;
            }
        }
    } catch (e) {
        console.warn("Warning: Error occurred in extractFinishReason:", e);
        return null;
    }
    return null;
}

function processStream({ element, returnValue, spanProcessor }) {
    let waitingForFirstToken = true;
    const streamStartTime = Date.now(); // milliseconds
    let firstTokenTime = streamStartTime;
    let streamClosedTime: number = null;
    let accumulatedResponse = '';
    let tokenUsage = null;

    function patchInstanceMethod(obj, methodName, func) {
        const originalProto = Object.getPrototypeOf(obj);
        const newProto = Object.create(originalProto);
        newProto[methodName] = func;
        Object.setPrototypeOf(obj, newProto);
    }
    let handled = false;

    if (element && typeof returnValue[Symbol.iterator] === 'function') {
        handled = true;
        const originalIter = returnValue[Symbol.iterator].bind(returnValue);

        function* newIter() {
            for (const item of originalIter()) {
                try {
                    if (item.choices && item.choices[0].delta && item.choices[0].delta.content) {
                        if (waitingForFirstToken) {
                            waitingForFirstToken = false;
                            firstTokenTime = Date.now();
                        }
                        accumulatedResponse += item.choices[0].delta.content;
                    } else if (item.object === "chat.completion.chunk" && item.usage) {
                        tokenUsage = item.usage;
                        streamClosedTime = Date.now();
                    }
                } catch (e) {
                    console.warn("Warning: Error occurred while processing item in newIter:", e);
                } finally {
                    yield item;
                }
            }

            if (spanProcessor) {
                const retVal = {
                    type: "stream",
                    timestamps: {
                        "data.input": streamStartTime,
                        "data.output": firstTokenTime,
                        "metadata": streamClosedTime || Date.now(),
                    },
                    output_text: accumulatedResponse,
                    usage: tokenUsage,
                };
                spanProcessor({ finalReturnValue: retVal });
            }
        }

        patchInstanceMethod(returnValue, Symbol.iterator, newIter);
    }

    if (element && typeof returnValue[Symbol.asyncIterator] === 'function') {
        handled = true;
        const originalAIter = returnValue[Symbol.asyncIterator].bind(returnValue);

        async function* newAIter() {
            for await (const item of originalAIter()) {
                try {
                    if (item.choices && item.choices[0].delta && item.choices[0].delta.content) {
                        if (waitingForFirstToken) {
                            waitingForFirstToken = false;
                            firstTokenTime = Date.now();
                        }
                        accumulatedResponse += item.choices[0].delta.content;
                    }
                    else if (typeof item.delta === "string") {
                        if (waitingForFirstToken) {
                            waitingForFirstToken = false;
                            firstTokenTime = Date.now();
                        }
                        accumulatedResponse += item.delta;
                    }
                    else if (item.type === "response.completed" && item.response.usage) {
                        tokenUsage = item.response.usage;
                        streamClosedTime = Date.now();
                    }
                } catch (e) {
                    console.warn("Warning: Error occurred while processing item in newAIter:", e);
                } finally {
                    yield item;
                }
            }

            if (spanProcessor) {
                const retVal = {
                    type: "stream",
                    timestamps: {
                        "data.input": streamStartTime,
                        "data.output": firstTokenTime,
                        "metadata": streamClosedTime || Date.now(),
                    },
                    output_text: accumulatedResponse,
                    usage: tokenUsage,
                };
                spanProcessor({ finalReturnValue: retVal });
            }
        }

        patchInstanceMethod(returnValue, Symbol.asyncIterator, newAIter);
    }
    // Non streaming case
    if (!handled && spanProcessor && returnValue && typeof returnValue === "object") {
        spanProcessor({ finalReturnValue: returnValue });
    }
}

// What the model emitted this turn: text, tool calls, or both, in order. A
// tool-calling turn spends its tokens on the call, so reading text alone records
// nothing for it. Tool-call shape matches the Mastra metamodel.
function collectModelOutput(response: any): string[] {
    const parts: string[] = [];

    // Responses API: output[] holds the emitted items in order.
    if (Array.isArray(response?.output)) {
        for (const item of response.output) {
            if (item?.type === "function_call" || item?.type === "custom_tool_call") {
                parts.push(JSON.stringify({ name: item.name, arguments: item.arguments }));
                continue;
            }
            if (Array.isArray(item?.content)) {
                const text = item.content
                    .filter((part: any) => typeof part?.text === "string")
                    .map((part: any) => part.text)
                    .join("");
                if (text) {
                    parts.push(text);
                }
            }
        }
    }

    // chat.completions: content and tool_calls sit on the message together.
    const message = response?.choices?.[0]?.message;
    if (message) {
        if (typeof message.content === "string" && message.content) {
            parts.push(message.content);
        }
        for (const call of message.tool_calls ?? []) {
            const fn = call?.function ?? call;
            parts.push(JSON.stringify({ name: fn?.name, arguments: fn?.arguments }));
        }
    }

    return parts;
}

export const config = {
    "type": "inference",
    "attributes": [
        [
            {
                "_comment": "provider type ,name , deployment , inference_endpoint",
                "attribute": "type",
                "accessor": function ({ instance }) {
                    if (instance._client && instance._client.baseURL && instance._client.baseURL.includes(".openai.com")) {
                        return "inference.openai"
                    }
                    else {
                        return "inference.azure_openai"
                    }
                }
            },
            {
                "attribute": "deployment",
                "accessor": function ({ instance, args }) {
                    return args[0].model_name || args[0].model || instance.deployment_name
                }
            },
            {
                "attribute": "inference_endpoint",
                "accessor": function ({ instance }) {
                    return instance?._client?.baseURL
                }
            }
        ],
        [
            {
                "_comment": "LLM Model",
                "attribute": "name",
                "accessor": function ({ args }) {
                    return args[0].model_name || args[0].model
                }
            },
            {
                "attribute": "type",
                "accessor": function ({ args }) {
                    return "model.llm." + (args[0].model_name || args[0].model)
                }
            }
        ]
    ],
    "response_processor": processStream,
    "events": [
        {
            "name": "data.input",
            "attributes": [

                {
                    "_comment": "this is input to LLM",
                    "attribute": "input",
                    "accessor": function ({ args }) {
                        try {
                            // Handle responses.create() format
                            if (args[0].input !== undefined) {
                                const inputs = [];
                                if (args[0].input && Array.isArray(args[0].input)) {
                                    for (const inp of args[0].input) {
                                        if (inp.role && inp.content) {
                                            inputs.push(`{'${inp.role}': '${inp.content}'} `);
                                        }
                                    }
                                }
                                else {
                                    if (args[0].instructions) {
                                        inputs.push(`{'instructions': '${args[0].instructions}'}`);
                                    }
                                    inputs.push(`{'input': '${JSON.stringify(args[0].input)}'}`);
                                }
                                return inputs;
                            }

                            // Handle original chat.completions.create() format
                            const messages: string[] = [];
                            if (args[0].messages && args[0].messages.length > 0) {
                                for (const msg of args[0].messages) {
                                    if (msg.content && msg.role) {
                                        messages.push(`{ '${[msg.role]}': '${msg.content} }'`);
                                    }
                                }
                            }

                            return messages
                        } catch (e) {
                            console.warn(`Warning: Error occurred in extractMessages: ${e}`);
                            return [];
                        }
                    }
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [

                {
                    "_comment": "this is response from LLM",
                    "attribute": "response",
                    "accessor": function ({ response, exception }) {
                        if (exception) {
                            return getExceptionMessage({ exception });
                        }
                        const emitted = collectModelOutput(response);
                        if (emitted.length) {
                            return [emitted.join(" ")];
                        }
                        // Streaming accumulates onto output_text with no output[].
                        if (response?.output_text !== undefined) {
                            return [response.output_text];
                        }

                        // Handle original chat.completions.create() format
                        return response?.choices?.[0]?.message?.content ? [response.choices?.[0].message.content] : [];
                    }
                },
                {
                    "attribute": "status",
                    "accessor": (args) => {
                        return getStatus(args);
                    }
                },
                {
                    "attribute": "status_code",
                    "accessor": (args) => {
                        return getStatusCode(args);
                    }
                },
            ]
        },
        {
            "name": "metadata",
            "attributes": [

                {
                    "_comment": "this is metadata from LLM",
                    "accessor": function ({ response }) {
                        if (response?.usage !== undefined) {
                            return {
                                "prompt_tokens": response.usage?.input_tokens || response.usage?.prompt_tokens,
                                "completion_tokens": response.usage?.output_tokens || response.usage?.completion_tokens,
                                "total_tokens": response.usage?.total_tokens || response.usage?.total_tokens,
                            }
                        }
                        return null;
                    }
                },
                {
                    "_comment": "finish reason from OpenAI response",
                    "attribute": "finish_reason",
                    "accessor": function ({ response }) {
                        return extractFinishReason(response);
                    }
                },
                {
                    "_comment": "finish type mapped from finish reason",
                    "attribute": "finish_type",
                    "accessor": function ({ response }) {
                        const finishReason = extractFinishReason(response);
                        return mapOpenaiFinishReasonToFinishType(finishReason);
                    }
                },
                {
                    "_comment": "tool_call when the turn emitted tool calls, else turn_end",
                    "attribute": "inference_sub_type",
                    "accessor": function ({ response }) {
                        const finishReason = extractFinishReason(response);
                        return finishReason === "tool_calls" || finishReason === "function_call"
                            ? INFERENCE_TOOL_CALL
                            : INFERENCE_TURN_END;
                    }
                }
            ]
        },
    ]
}

export class OpenAISpanHandler extends NonFrameworkSpanHandler {
    // Deferring only makes sense when the framework emits its own span carrying
    // the same data. That holds for chat/responses calls, but not for
    // embeddings: a framework's retriever span reports the retrieved documents,
    // never the embedding model or the vector, so those spans must keep their
    // own "retrieval" processing even under a framework workflow.
    private readonly deferToFrameworkSpan: boolean;

    constructor({ deferToFrameworkSpan = true }: { deferToFrameworkSpan?: boolean } = {}) {
        super();
        this.deferToFrameworkSpan = deferToFrameworkSpan;
    }

    // A model call inside an agent invocation belongs to it, but that span is
    // not on the OTel context (see agenticInvocation), so name it as the parent
    // explicitly and carry its scope across. Inert outside an agentic run.
    preTracing(element: WrapperArguments, currentContext: any, thisArg?: any): any {
        const invocation = getOpenAgentInvocation(currentContext);
        if (!invocation) {
            return super.preTracing(element, currentContext, thisArg);
        }
        let updated = currentContext.setValue(MONOCLE_ACTIVE_SPAN_KEY, invocation.span);
        if (invocation.scopeId) {
            updated = updateBaggageContextWithScopes(updated, {
                [SCOPE_AGENTIC_INVOCATION]: invocation.scopeId,
            });
        }
        return updated;
    }

    isTeamsSpanInProgress() {
        const currentActiveWorkflowType = context.active().getValue(WORKFLOW_TYPE_KEY_SYMBOL) || WORKFLOW_TYPE_GENERIC;
        return currentActiveWorkflowType === "workflow.teams_ai"
    }

    // Teams AI: handled specially in processSpan, so skip here.
    // Other frameworks (e.g. LangChain): skip so we don't duplicate
    // data.input/data.output/metadata already carried by the framework's own
    // inference span (errors are still recorded via the exception path).
    skipProcessor({ instance, args, element }: {
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }) {
        if (!this.deferToFrameworkSpan) {
            return false;
        }
        if (this.isTeamsSpanInProgress()) {
            return true;
        }
        return super.skipProcessor({ instance, args, element });
    }

    processSpan({ span, instance, args, returnValue, outputProcessor, wrappedPackage, exception, parentSpan }: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
        wrappedPackage: string;
        exception?: any;
        parentSpan?: Span;
    }) {
        if (this.deferToFrameworkSpan && this.isTeamsSpanInProgress() && !exception) {
            super.processSpan({
                span: parentSpan,
                instance,
                args,
                returnValue,
                outputProcessor,
                wrappedPackage: wrappedPackage,
                exception,
                parentSpan: null,
            });
        }
        else {
            super.processSpan({
                span,
                instance,
                args,
                returnValue,
                outputProcessor,
                wrappedPackage: wrappedPackage,
                exception,
                parentSpan

            });
        }

        // Under a framework workflow, mark this as the model-API span so it
        // isn't treated as a second primary inference span. Direct calls keep
        // the schema's default "inference" type.
        if (this.deferToFrameworkSpan && this.checkActiveWorkflowType()) {
            span.setAttribute("span.type", "inference.modelapi");
        }

    }
}
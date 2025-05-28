import { context } from "@opentelemetry/api";
import { WORKFLOW_TYPE_GENERIC, WORKFLOW_TYPE_KEY_SYMBOL, WrapperArguments } from "../../../common/constants";
import { NonFrameworkSpanHandler } from "../../../common/spanHandler";
import { Span } from "../../../common/opentelemetryUtils";

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

    if (element && typeof returnValue[Symbol.iterator] === 'function') {
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
}

function getStatusCode(args) {
    if (args.exception) {
        return getExceptionStatusCode(args);
    }
    else if (args.response && args.response.status) {
        return args.response.status;
    }
    else {
        return "success";
    }
}

function getExceptionMessage(args) {
  if (args.exception) {
    if (args.exception.message) {
      return args.exception.message;
    }
    else {
      return args.exception.toString();
    }
  }
  else {
    return "";
  }
}

function getStatus(args) {
    if (args.exception) {
        return "error";
    }
    else if (getStatusCode(args) === "success") {
        return "success";
    }
    else {
        return "error";
    }
}
// function checkStatus(args) {
//   const status = getStatusCode(args);
//   if (status !== "success") {
//     throw new MonocleSpanException(status);
//   }
// }
function getExceptionStatusCode(args) {
    if (args.exception && args.exception.code) {
        return args.exception.code;
    }
    else {
        return "error";
    }
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
                                if (args[0].instructions) {
                                    inputs.push(`{'instructions': '${args[0].instructions}'}`);
                                }
                                inputs.push(`{'input': '${args[0].input}'}`);
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
                        if (exception){
                            return getExceptionMessage({ exception });
                        }
                        if (response?.output_text !== undefined) {
                            return [response.output_text];
                        }

                        // Handle original chat.completions.create() format
                        return response?.choices?.[0]?.message?.content ? [response.choices?.[0].message.content] : []
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
                                "prompt_tokens": response.usage?.input_tokens,
                                "completion_tokens": response.usage?.output_tokens,
                                "total_tokens": response.usage?.total_tokens,
                            }
                        }
                        return null;
                    }
                }
            ]
        },
    ]
}

export class OpenAISpanHandler extends NonFrameworkSpanHandler {
    isTeamsSpanInProgress() {
        const currentActiveWorkflowType = context.active().getValue(WORKFLOW_TYPE_KEY_SYMBOL) || WORKFLOW_TYPE_GENERIC;
        return currentActiveWorkflowType === "workflow.teams_ai"
    }

    // If openAI is being called by Teams AI SDK, then retain the metadata part of the span events
    skipProcessor({ instance, args, element }: {
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }) {
        if (this.isTeamsSpanInProgress()) {
            return true;
        } else {
            return super.skipProcessor({ instance, args, element });
        }
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
        if (this.isTeamsSpanInProgress() && !exception) {
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
        else{
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

        if(this.checkActiveWorkflowType()) {
            span.setAttribute("span.type", "inference.modelapi");
        }

    }
}
import {
    INFERENCE_TOOL_CALL,
    INFERENCE_TURN_END,
    SPAN_TYPES,
    TOOL_FUNCTION_TYPE,
} from "../../../common/constants";
import { getExceptionMessage } from "../../utils";

// Mastra routes every provider through an AI-SDK LanguageModelV2 wrapper
// (ModelRouterLanguageModel), so one wrap point on doGenerate/doStream covers
// all providers. This schema reads model / provider / usage / finish reason
// generically off that wrapper and the aggregated result — no per-provider code.
// Shapes follow the AI-SDK LanguageModelV2 spec:
//   input:  options.prompt = Array<{ role, content }>, content = string | Part[]
//   output: result.content = Part[] ({type:'text'|'tool-call'|'reasoning'|...})
//   usage:  { inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens }
//   finishReason: 'stop'|'length'|'content-filter'|'tool-calls'|'error'|'other'|'unknown'

// Mastra's model router normalizes finishReason to an object ({ unified: "stop" }),
// while raw AI-SDK models return a plain string. Handle both.
function finishReasonString(result: any): string | undefined {
    const fr = result?.finishReason ?? result?.response?.finishReason;
    if (typeof fr === "string") return fr;
    if (fr && typeof fr.unified === "string") return fr.unified;
    return undefined;
}

// A "tool-calls" finish means the model asked to call a tool (mid-turn);
// anything else is the turn ending. Mirrors the Gemini metamodel's dynamic
// inference subtype.
function classifyInferenceSubtype(result: any): string {
    return finishReasonString(result) === "tool-calls" ? INFERENCE_TOOL_CALL : INFERENCE_TURN_END;
}

// Map the finish reason to a coarse finish type.
function mapFinishType(finishReason: string | undefined): string {
    switch (finishReason) {
        case "tool-calls": return "tool_call";
        case "stop": return "stop";
        case "length": return "length";
        case "content-filter": return "content_filter";
        case "error": return "error";
        case undefined: return "unknown";
        default: return finishReason as string;
    }
}

// Token counts arrive either as flat numbers (raw AI-SDK models: inputTokens =
// 125) or as nested objects (Mastra's model router: inputTokens = { total,
// cacheRead, ... }, outputTokens = { total, text, reasoning }). Pull the scalar
// out of either. OTel drops non-primitive attribute values, so this MUST yield
// numbers, never the nested objects.
function tokenTotal(v: any): number | undefined {
    if (typeof v === "number") return v;
    if (v && typeof v.total === "number") return v.total;
    return undefined;
}

function extractUsage(response: any): Record<string, number> {
    const usage = response?.usage;
    if (!usage || typeof usage !== "object") return {};
    const out: Record<string, number> = {};
    const prompt = tokenTotal(usage.inputTokens) ?? usage.raw?.input_tokens;
    const completion = tokenTotal(usage.outputTokens) ?? usage.raw?.output_tokens;
    if (typeof prompt === "number") out.prompt_tokens = prompt;
    if (typeof completion === "number") out.completion_tokens = completion;
    const total = typeof usage.totalTokens === "number"
        ? usage.totalTokens
        : (typeof prompt === "number" && typeof completion === "number" ? prompt + completion : undefined);
    if (typeof total === "number") out.total_tokens = total;
    const reasoning = (typeof usage.outputTokens?.reasoning === "number" ? usage.outputTokens.reasoning : undefined)
        ?? (typeof usage.reasoningTokens === "number" ? usage.reasoningTokens : undefined)
        ?? usage.raw?.output_tokens_details?.reasoning_tokens;
    if (typeof reasoning === "number" && reasoning > 0) out.reasoning_tokens = reasoning;
    const cached = (typeof usage.inputTokens?.cacheRead === "number" ? usage.inputTokens.cacheRead : undefined)
        ?? (typeof usage.cachedInputTokens === "number" ? usage.cachedInputTokens : undefined)
        ?? usage.raw?.input_tokens_details?.cached_tokens;
    if (typeof cached === "number" && cached > 0) out.cached_tokens = cached;
    return out;
}

// Map Mastra's model-router provider id (e.g. "openai", "anthropic") to a
// provider-specific inference type, mirroring the vercelAI metamodel.
function inferenceProviderType(provider: string | undefined): string {
    const p = (provider || "").toLowerCase();
    if (p.startsWith("azure")) return "inference.azure_openai";
    if (p.startsWith("openai")) return "inference.openai";
    if (p.startsWith("anthropic")) return "inference.anthropic";
    if (p.startsWith("google") || p.startsWith("gemini") || p.startsWith("vertex")) return "inference.gemini";
    if (p.includes("bedrock") || p.includes("amazon") || p.includes("aws")) return "inference.aws_bedrock";
    if (p.includes("mistral")) return "inference.mistral";
    return p ? "inference." + p : "inference.generic";
}

// Best-effort inference endpoint off the model wrapper (baseURL if the resolved
// provider exposes one, else the router gateway id). Returns undefined when
// nothing is available so the attribute is omitted.
function extractEndpoint(instance: any): string | undefined {
    return (
        instance?.config?.baseURL ??
        instance?.baseURL ??
        instance?.config?.url ??
        instance?.gatewayId ??
        undefined
    );
}

// Declared tools live on options.tools: LanguageModelV2FunctionTool
// ({type:'function', name, ...}) or provider-defined tools ({name}).
function extractToolNames(args: any[]): string[] {
    const tools = args?.[0]?.tools;
    if (!Array.isArray(tools)) return [];
    return tools.map((t: any) => t?.name).filter((n: any) => typeof n === "string" && n);
}

// Flatten one LanguageModelV2 message's content (string, or an array of typed
// parts) to a readable string. Non-text parts (tool-call / tool-result /
// reasoning) are serialized so tool-using turns aren't dropped.
function messageToText(content: any): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const part of content) {
        if (!part || typeof part !== "object") continue;
        switch (part.type) {
            case "text":
                if (typeof part.text === "string" && part.text) parts.push(part.text);
                break;
            case "reasoning":
                if (typeof part.text === "string" && part.text) parts.push(part.text);
                break;
            case "tool-call":
                parts.push(JSON.stringify({ tool_call: { name: part.toolName, arguments: part.input } }));
                break;
            case "tool-result":
                parts.push(JSON.stringify({ tool_result: { name: part.toolName, output: part.output ?? part.result } }));
                break;
            default:
                break;
        }
    }
    return parts.join(" ");
}

// Input is options.prompt (args[0].prompt): a LanguageModelV2 prompt — an array
// of { role, content } messages. Normalize each to a { role: text } JSON string.
function extractMessages(args: any[]): string[] {
    const prompt = args?.[0]?.prompt;
    if (!Array.isArray(prompt)) return [];
    const out: string[] = [];
    for (const message of prompt) {
        const role = message?.role || "user";
        const text = messageToText(message?.content);
        if (text) out.push(JSON.stringify({ [role]: text }));
    }
    return out;
}

// Output lives in result.content (an array of parts) — there is no result.text
// at the LanguageModelV2 layer. Prefer assistant text; fall back to a serialized
// tool call when the model chose to call a tool instead of answering.
function extractOutput({ response, exception }: any): string {
    if (exception) return getExceptionMessage({ exception });
    if (response?.error) {
        return response.error.message || JSON.stringify(response.error);
    }
    const content = response?.content ?? response?.response?.content;
    const texts = Array.isArray(content)
        ? content.filter((p: any) => p?.type === "text" && typeof p.text === "string").map((p: any) => p.text)
        : [];
    if (texts.length) return texts.join("");
    if (Array.isArray(content)) {
        const calls = content
            .filter((p: any) => p?.type === "tool-call")
            .map((p: any) => JSON.stringify({ name: p.toolName, arguments: p.input }));
        if (calls.length) return calls.join(" ");
    }
    // Last-resort fallbacks for shapes that surface aggregated text directly.
    if (typeof response?.text === "string") return response.text;
    return "";
}

export const INFERENCE = {
    "type": SPAN_TYPES.INFERENCE,
    "subtype": function ({ response, output }: any) {
        return classifyInferenceSubtype(response ?? output);
    },
    "attributes": [
        [
            {
                "_comment": "inference provider type",
                "attribute": "type",
                "accessor": function ({ instance }: any) {
                    return inferenceProviderType(instance?.provider);
                },
            },
            {
                "_comment": "inference endpoint (best-effort)",
                "attribute": "inference_endpoint",
                "accessor": function ({ instance }: any) {
                    return extractEndpoint(instance);
                },
            },
        ],
        [
            {
                "_comment": "LLM model type",
                "attribute": "type",
                "accessor": function ({ instance }: any) {
                    return "model.llm." + (instance?.modelId || "");
                },
            },
            {
                "_comment": "LLM model name",
                "attribute": "name",
                "accessor": function ({ instance }: any) {
                    return instance?.modelId || "";
                },
            },
        ],
        [
            {
                "_comment": "tools declared on the request (function tools)",
                "attribute": "name",
                "accessor": function ({ args }: any) {
                    const names = extractToolNames(args);
                    return names.length > 0 ? names.join(", ") : undefined;
                },
            },
            {
                "_comment": "tool type marker (only present when tools were declared)",
                "attribute": "type",
                "accessor": function ({ args }: any) {
                    return extractToolNames(args).length > 0 ? TOOL_FUNCTION_TYPE : undefined;
                },
            },
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "input messages sent to the model (LanguageModelV2 prompt)",
                    "attribute": "input",
                    "accessor": function ({ args }: any) {
                        return extractMessages(args);
                    },
                },
            ],
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "assistant text (or serialized tool call) from the model",
                    "attribute": "response",
                    "accessor": function ({ response, exception }: any) {
                        return extractOutput({ response, exception });
                    },
                },
            ],
        },
        {
            "name": "metadata",
            "attributes": [
                {
                    // No `attribute` key: the returned dict of numeric token
                    // counts is spread onto the metadata event. Emits only the
                    // fields that are present (scalars only — never objects).
                    "_comment": "token usage (prompt/completion/total/reasoning/cached)",
                    "accessor": function ({ response }: any) {
                        const usage = extractUsage(response);
                        return Object.keys(usage).length > 0 ? usage : undefined;
                    },
                },
                {
                    "_comment": "raw finish reason from the model",
                    "attribute": "finish_reason",
                    "accessor": function ({ response }: any) {
                        return finishReasonString(response);
                    },
                },
                {
                    "_comment": "finish type mapped from finish reason",
                    "attribute": "finish_type",
                    "accessor": function ({ response }: any) {
                        return mapFinishType(finishReasonString(response));
                    },
                },
            ],
        },
    ],
};

// Streaming (agent.stream() → model.doStream()). doStream resolves to
// { stream: ReadableStream }; text/usage/finishReason come from consuming it, so
// we observe the stream and synthesize a doGenerate-shaped { content, usage,
// finishReason } and reuse the INFERENCE accessors above.

interface StreamAcc {
    text: string[];
    toolCalls: any[];
    usage: any;
    finishReason: any;
}

// Stream part types: text-delta ({ delta }), tool-call, finish ({ usage,
// finishReason }); markers (stream-start/text-start/…) are ignored.
function accumulateStreamPart(part: any, acc: StreamAcc): void {
    const type = part?.type;
    if (type === "text-delta" && typeof part.delta === "string") {
        acc.text.push(part.delta);
    } else if (type === "text" && typeof part.text === "string") {
        acc.text.push(part.text);
    } else if (type === "tool-call") {
        acc.toolCalls.push({ type: "tool-call", toolName: part.toolName, input: part.input });
    } else if (type === "finish") {
        acc.usage = part.usage;
        acc.finishReason = part.finishReason;
    }
}

function synthesizeStreamResult(acc: StreamAcc): any {
    const content: any[] = [];
    if (acc.text.length) content.push({ type: "text", text: acc.text.join("") });
    content.push(...acc.toolCalls);
    return { content, usage: acc.usage, finishReason: acc.finishReason };
}

// Swaps returnValue.stream for a pass-through that accumulates parts, and defers
// the span until the stream closes.
function processMastraStream({ returnValue, spanProcessor }: any): void {
    const source = returnValue?.stream;
    // No stream to observe → finalize immediately.
    if (!source || typeof source.pipeThrough !== "function") {
        if (spanProcessor) spanProcessor({ finalReturnValue: returnValue });
        return;
    }

    const acc: StreamAcc = { text: [], toolCalls: [], usage: null, finishReason: null };
    let finalized = false;
    const finalize = () => {
        if (finalized || !spanProcessor) return;
        finalized = true;
        spanProcessor({ finalReturnValue: synthesizeStreamResult(acc) });
    };

    const observer = new TransformStream({
        transform(chunk, controller) {
            try { accumulateStreamPart(chunk, acc); } catch { /* ignore a bad part */ }
            controller.enqueue(chunk);
        },
        flush() {
            finalize();
        },
    });

    try {
        returnValue.stream = source.pipeThrough(observer);
    } catch {
        // Can't swap the stream (frozen) → finalize now instead of leaking a span.
        finalize();
    }
}

// INFERENCE + the stream-accumulating response_processor.
export const INFERENCE_STREAM = {
    ...INFERENCE,
    response_processor: processMastraStream,
};

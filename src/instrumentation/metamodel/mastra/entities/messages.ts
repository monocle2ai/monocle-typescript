import { getExceptionMessage } from "../../utils";

// Shared by AGENT_REQUEST and AGENT_INVOCATION, which read the same
// generate()/stream() arguments and return value.

function extractContentText(content: any): string {
    if (content == null) return "";
    if (typeof content === "string") return content;
    const parts = Array.isArray(content) ? content : undefined;
    if (Array.isArray(parts)) {
        return parts
            .map((p: any) => (typeof p === "string" ? p : p?.text || ""))
            .filter((t: string) => t)
            .join(" ");
    }
    return "";
}

// Mastra's generate()/stream() take the messages as args[0]: a string, or an
// array / single message object. The text may live on `.content` (string or
// text parts), `.parts` (AI SDK UI messages), or `.contents` (Mastra message
// signals from the playground); role may be on `.role` or `.type`. Normalize
// each to a {role: text} JSON string.
export function extractUserInput(args: any[]): string[] {
    const messages = args?.[0];
    if (messages == null) return [];
    const arr = Array.isArray(messages) ? messages : [messages];
    const out: string[] = [];
    for (const m of arr) {
        if (typeof m === "string") {
            if (m) out.push(JSON.stringify({ user: m }));
            continue;
        }
        const role = m?.role || m?.type || "user";
        const text = extractContentText(m?.content ?? m?.parts ?? m?.contents);
        if (text) out.push(JSON.stringify({ [role]: text }));
    }
    return out;
}

// Both generate() (returns FullOutput) and stream() (FullOutput resolved via
// getFullOutput() in the wrapper) expose the final text on `.text`.
export function extractFinalText({ response, exception }: any): string {
    if (exception) return getExceptionMessage({ exception });
    const text = response?.text;
    return typeof text === "string" ? text : "";
}

// Both entities' `name` attribute.
export function extractAgentName(instance: any): string {
    return instance?.name || instance?.id || instance?.constructor?.name || "";
}

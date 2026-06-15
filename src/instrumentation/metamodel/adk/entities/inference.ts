import { context } from "@opentelemetry/api";
import { FROM_AGENT_KEY, FROM_AGENT_SPAN_ID_KEY, SPAN_SUBTYPES, SPAN_TYPES } from "../../../common/constants";
import { getExceptionMessage } from "../../utils";

const ADK_AGENT_TYPE = "agent.adk";

function extractContentText(content: any): string {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content?.parts)) {
        return content.parts
            .map((p: any) => (typeof p === "string" ? p : p?.text || ""))
            .filter((t: string) => t)
            .join(" ");
    }
    return "";
}

function extractUserInput(args: any[]): string[] {
    const params = args?.[0];
    const newMessage = params?.newMessage;
    if (!newMessage) return [];
    const role = newMessage.role || "user";
    const text = extractContentText(newMessage);
    return text ? [JSON.stringify({ [role]: text })] : [];
}

function extractFinalResponseFromEvents(returnValue: any): string {
    if (!returnValue || returnValue.type !== "async_generator") return "";
    const events = returnValue.events || [];
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (!event?.content || event.partial === true) continue;
        if (event.author === "user") continue;
        const text = extractContentText(event.content);
        if (text) return text;
    }
    return "";
}

// Reads delegation info that ADKAgentSpanHandler.preTracing stamped on the
// OTel context. Returns undefined for top-level invocations (no key set),
// so the attribute is omitted — matching Python monocle's behavior.
//
// We can't derive this from args because ADK rebuilds the InvocationContext
// at every layer with `agent: this`, so args[0].agent.name === self.name in
// both top-level AND delegation cases. The delegator's identity lives on a
// private context key, stamped by the previous agent's wrapper.
function readFromAgent(): string | undefined {
    return context.active().getValue(FROM_AGENT_KEY) as string | undefined;
}

function readFromAgentSpanId(): string | undefined {
    return context.active().getValue(FROM_AGENT_SPAN_ID_KEY) as string | undefined;
}

export const AGENT = {
    "type": SPAN_TYPES.AGENTIC_INVOCATION,
    // content_processing matches Python monocle's AGENT schema. ROUTING is
    // reserved for orchestrator agents (Sequential/Loop/Parallel) — see
    // Python's AGENT_ORCHESTRATOR.
    "subtype": SPAN_SUBTYPES.CONTENT_PROCESSING,
    "attributes": [
        [
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return ADK_AGENT_TYPE;
                },
            },
            {
                "_comment": "name of the agent",
                "attribute": "name",
                "accessor": function ({ instance }: any) {
                    return instance?.name || instance?.constructor?.name || "";
                },
            },
            {
                "_comment": "agent description",
                "attribute": "description",
                "accessor": function ({ instance }: any) {
                    return instance?.description || "";
                },
            },
            {
                "_comment": "name of the agent that delegated to this one (omitted on top-level invocations)",
                "attribute": "from_agent",
                "accessor": function () {
                    return readFromAgent();
                },
            },
            {
                "_comment": "span_id of the delegating agent's invocation",
                "attribute": "from_agent_span_id",
                "accessor": function () {
                    if (!readFromAgent()) return undefined;
                    return readFromAgentSpanId();
                },
            },
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "agent invocation input — first user message in the parent context",
                    "attribute": "input",
                    "accessor": function ({ args }: any) {
                        const ctx = args?.[0];
                        const session = ctx?.session;
                        const events = session?.events;
                        if (Array.isArray(events) && events.length > 0) {
                            for (const e of events) {
                                if (e?.author === "user" && e?.content) {
                                    const text = extractContentText(e.content);
                                    if (text) return [JSON.stringify({ user: text })];
                                }
                            }
                        }
                        const userContent = ctx?.userContent;
                        if (userContent) {
                            const text = extractContentText(userContent);
                            if (text) return [JSON.stringify({ user: text })];
                        }
                        return [];
                    },
                },
            ],
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "final assistant response from the agent",
                    "attribute": "response",
                    "accessor": function ({ response, exception }: any) {
                        if (exception) return getExceptionMessage({ exception });
                        return extractFinalResponseFromEvents(response);
                    },
                },
            ],
        },
        // Token usage intentionally omitted: this is an agentic span, not an
        // inference span. Token counts live on the underlying gemini.* spans.
    ],
};

export const AGENT_REQUEST = {
    "type": "agentic.turn",
    "subtype": SPAN_SUBTYPES.TURN,
    "attributes": [
        [
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return ADK_AGENT_TYPE;
                },
            },
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "user message passed into runner.runAsync / runEphemeral",
                    "attribute": "input",
                    "accessor": function ({ args }: any) {
                        return extractUserInput(args);
                    },
                },
            ],
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "final assistant response across the run",
                    "attribute": "response",
                    "accessor": function ({ response, exception }: any) {
                        if (exception) return getExceptionMessage({ exception });
                        return extractFinalResponseFromEvents(response);
                    },
                },
            ],
        },
        // Token usage intentionally omitted: this is an agentic request span,
        // not an inference span. Token counts live on the underlying gemini.*
        // spans.
    ],
};


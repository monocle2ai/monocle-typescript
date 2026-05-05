import { SPAN_SUBTYPES, SPAN_TYPES } from "../../../common/constants";
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

function extractUsageFromEvents(returnValue: any): Record<string, number> | null {
    if (!returnValue || returnValue.type !== "async_generator") return null;
    const events = returnValue.events || [];
    let prompt = 0, completion = 0, total = 0, found = false;
    for (const event of events) {
        const usage = event?.usageMetadata;
        if (!usage) continue;
        found = true;
        prompt += usage.promptTokenCount || 0;
        completion += usage.candidatesTokenCount || 0;
        total += usage.totalTokenCount || 0;
    }
    return found ? { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total } : null;
}

function extractAgentToolNames(instance: any): string[] {
    if (!Array.isArray(instance?.tools)) return [];
    return instance.tools
        .map((t: any) => t?.name || t?.agent?.name || "")
        .filter((n: string) => n);
}

export const AGENT = {
    "type": SPAN_TYPES.AGENTIC_INVOCATION,
    "subtype": SPAN_SUBTYPES.ROUTING,
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
                "_comment": "tools available to the agent",
                "attribute": "tools",
                "accessor": function ({ instance }: any) {
                    const names = extractAgentToolNames(instance);
                    return names.length > 0 ? names : undefined;
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
        {
            "name": "metadata",
            "attributes": [
                {
                    "_comment": "aggregated token usage across model events",
                    "accessor": function ({ response }: any) {
                        return extractUsageFromEvents(response);
                    },
                },
            ],
        },
    ],
};

export const AGENT_REQUEST = {
    "type": SPAN_TYPES.AGENTIC_REQUEST,
    "subtype": SPAN_SUBTYPES.PLANNING,
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
                "_comment": "root agent name as configured on the runner",
                "attribute": "name",
                "accessor": function ({ instance }: any) {
                    return instance?.agent?.name || instance?.appName || "";
                },
            },
            {
                "_comment": "app name configured on the runner",
                "attribute": "app_name",
                "accessor": function ({ instance }: any) {
                    return instance?.appName || "";
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
        {
            "name": "metadata",
            "attributes": [
                {
                    "_comment": "aggregated token usage across model events",
                    "accessor": function ({ response }: any) {
                        return extractUsageFromEvents(response);
                    },
                },
            ],
        },
    ],
};

export const AGENT_DELEGATION = {
    "type": SPAN_TYPES.AGENTIC_DELEGATION,
    "subtype": SPAN_SUBTYPES.ROUTING,
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
                "_comment": "name of the agent invoking the delegation",
                "attribute": "from_agent",
                "accessor": function ({ args }: any) {
                    return args?.[0]?.toolContext?.invocationContext?.agent?.name || "";
                },
            },
            {
                "_comment": "name of the agent being delegated to",
                "attribute": "to_agent",
                "accessor": function ({ instance }: any) {
                    return instance?.agent?.name || "";
                },
            },
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "delegation arguments passed to the sub-agent",
                    "attribute": "input",
                    "accessor": function ({ args }: any) {
                        const toolArgs = args?.[0]?.args;
                        return toolArgs ? [JSON.stringify(toolArgs)] : [];
                    },
                },
            ],
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "result returned by the delegated agent",
                    "attribute": "response",
                    "accessor": function ({ response, exception }: any) {
                        if (exception) return getExceptionMessage({ exception });
                        if (response === undefined || response === null) return "";
                        return typeof response === "string" ? response : JSON.stringify(response);
                    },
                },
            ],
        },
    ],
};

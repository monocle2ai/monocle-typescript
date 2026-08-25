import { context } from "@opentelemetry/api";
import {
    FROM_AGENT_KEY,
    SPAN_SUBTYPES,
    SPAN_TYPES,
} from "../../../common/constants";
import { extractAgentName, extractFinalText, extractUserInput } from "./messages";

const MASTRA_AGENT_TYPE = "agent.mastra";

// Stamped by MastraInvocationSpanHandler.preTracing.
function readFromAgent(): string | undefined {
    return context.active().getValue(FROM_AGENT_KEY) as string | undefined;
}


// One agent activation. The turn span covers the whole user request; this covers
// one agent's run within it, so a delegated sub-agent gets its own.
export const AGENT_INVOCATION = {
    "type": SPAN_TYPES.AGENTIC_INVOCATION,
    "subtype": SPAN_SUBTYPES.CONTENT_PROCESSING,
    "attributes": [
        [
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return MASTRA_AGENT_TYPE;
                },
            },
            {
                "_comment": "name of the agent",
                "attribute": "name",
                "accessor": function ({ instance }: any) {
                    return extractAgentName(instance);
                },
            },
            {
                "_comment": "agent description; Mastra exposes it as a getter",
                "attribute": "description",
                "accessor": function ({ instance }: any) {
                    const d = typeof instance?.getDescription === "function"
                        ? instance.getDescription()
                        : instance?.description;
                    return typeof d === "string" ? d : "";
                },
            },
            {
                "_comment": "delegating agent, omitted on top-level invocations",
                "attribute": "from_agent",
                "accessor": function () {
                    return readFromAgent();
                },
            },
            {
                // The delegation tool span is skipped (see delegationToolKeys), so a
                // sub-agent's parent is its delegator's invocation span — the same
                // shape ADK produces.
                "_comment": "span_id of the delegating agent's invocation",
                "attribute": "from_agent_span_id",
                "accessor": function ({ parentSpan }: any) {
                    if (!readFromAgent()) return undefined;
                    return parentSpan?.spanContext?.()?.spanId;
                },
            },
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "message(s) this agent was activated with",
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
                    "_comment": "this agent's response",
                    "attribute": "response",
                    "accessor": function ({ response, exception }: any) {
                        return extractFinalText({ response, exception });
                    },
                },
            ],
        },
    ],
};

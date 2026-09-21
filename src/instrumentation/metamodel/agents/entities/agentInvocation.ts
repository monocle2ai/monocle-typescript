import { SPAN_SUBTYPES, SPAN_TYPES } from "../../../common/constants";
import { AGENTS_AGENT_TYPE, safeStringify } from "../agentsHelper";

// One agent activation within a turn. The hook bridge assembles the shape the
// accessors below see, rather than it coming from a raw SDK call:
//
//   instance    = the Agent
//   args        = [agent, turnInput]
//   returnValue = { output, handoffTo, fromAgent, fromAgentSpanId }
//
// Note the two accessor shapes: processSpan gives entity attributes
// { instance, args, output, parentSpan } — `output` being that returnValue —
// and events { args, response, instance, exception }. So entity attributes read
// `output.*`, event attributes read `response.*`.
export const AGENT = {
    "type": SPAN_TYPES.AGENTIC_INVOCATION,
    "subtype": SPAN_SUBTYPES.CONTENT_PROCESSING,
    "attributes": [
        [
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return AGENTS_AGENT_TYPE;
                }
            },
            {
                "_comment": "name of the agent",
                "attribute": "name",
                "accessor": function ({ instance }: any) {
                    return instance?.name || "";
                }
            },
            {
                "_comment": "agent description; the SDK calls it handoffDescription",
                "attribute": "description",
                "accessor": function ({ instance }: any) {
                    return instance?.handoffDescription || instance?.description || "";
                }
            },
            {
                "_comment": "agent instructions; skipped when the SDK resolves them per run",
                "attribute": "instructions",
                "accessor": function ({ instance }: any) {
                    const instructions = instance?.instructions;
                    return typeof instructions === "string" ? instructions : "";
                }
            },
            {
                "_comment": "delegating agent, when this activation came from a handoff",
                "attribute": "from_agent",
                "accessor": function ({ output }: any) {
                    return output?.fromAgent || "";
                }
            },
            {
                "_comment": "invocation span of the delegating agent",
                "attribute": "from_agent_span_id",
                "accessor": function ({ output }: any) {
                    return output?.fromAgentSpanId || "";
                }
            }
        ]
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "input this agent was activated with",
                    "attribute": "input",
                    "accessor": function ({ args }: any) {
                        const turnInput = args?.[1];
                        if (turnInput === undefined || turnInput === null) {
                            return "";
                        }
                        return typeof turnInput === "string" ? turnInput : safeStringify(turnInput);
                    }
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "agent output, or the handoff target for a delegating agent",
                    "attribute": "response",
                    "accessor": function ({ response }: any) {
                        if (response?.output !== undefined && response?.output !== null) {
                            return typeof response.output === "string"
                                ? response.output
                                : safeStringify(response.output);
                        }
                        return response?.handoffTo ? `handoff to ${response.handoffTo}` : "";
                    }
                }
            ]
        }
    ]
};

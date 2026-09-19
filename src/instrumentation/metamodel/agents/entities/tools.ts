import { SPAN_SUBTYPES, SPAN_TYPES } from "../../../common/constants";
import { AGENTS_AGENT_TYPE, safeStringify, toolTypeOf } from "../agentsHelper";

// One tool call, assembled by the hook bridge from agent_tool_start /
// agent_tool_end:
//
//   instance    = the tool
//   args        = [toolCall, agent]
//   returnValue = { result }
//
// See agentInvocation.ts on the two accessor arg shapes.
//
// The calling agent (entity 2) comes off the event itself, which is what covers
// MCP, hosted and agent-as-tool calls — none of them pass through tool().
export const TOOL = {
    "type": SPAN_TYPES.AGENTIC_TOOL_INVOCATION,
    "subtype": SPAN_SUBTYPES.CONTENT_GENERATION,
    "attributes": [
        [
            {
                "_comment": "tool kind: function, MCP or hosted",
                "attribute": "type",
                "accessor": function ({ instance }: any) {
                    return toolTypeOf(instance);
                }
            },
            {
                "_comment": "name of the tool",
                "attribute": "name",
                "accessor": function ({ instance, args }: any) {
                    return instance?.name || args?.[0]?.name || "";
                }
            },
            {
                "_comment": "tool description",
                "attribute": "description",
                "accessor": function ({ instance }: any) {
                    return instance?.description || "";
                }
            }
        ],
        [
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return AGENTS_AGENT_TYPE;
                }
            },
            {
                "_comment": "name of the calling agent",
                "attribute": "name",
                "accessor": function ({ args }: any) {
                    return args?.[1]?.name || "";
                }
            }
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "arguments the model passed to the tool",
                    "attribute": "input",
                    "accessor": function ({ args }: any) {
                        const toolArgs = args?.[0]?.arguments;
                        if (toolArgs === undefined || toolArgs === null) {
                            return "";
                        }
                        return typeof toolArgs === "string" ? toolArgs : safeStringify(toolArgs);
                    }
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "tool result",
                    "attribute": "response",
                    "accessor": function ({ response }: any) {
                        const result = response?.result;
                        if (result === undefined || result === null) {
                            return "";
                        }
                        return typeof result === "string" ? result : safeStringify(result);
                    }
                }
            ]
        }
    ]
};

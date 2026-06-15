import { SPAN_SUBTYPES, SPAN_TYPES } from "../../../common/constants";
import { getExceptionMessage } from "../../utils";

const ADK_TOOL_TYPE = "tool.adk";
const ADK_AGENT_TYPE = "agent.adk";

export const TOOL = {
    "type": SPAN_TYPES.AGENTIC_TOOL_INVOCATION,
    "subtype": SPAN_SUBTYPES.CONTENT_GENERATION,
    "attributes": [
        [
            {
                "_comment": "tool type",
                "attribute": "type",
                "accessor": function () {
                    return ADK_TOOL_TYPE;
                },
            },
            {
                "_comment": "name of the tool",
                "attribute": "name",
                "accessor": function ({ instance }: any) {
                    return instance?.name || "";
                },
            },
            {
                "_comment": "tool description",
                "attribute": "description",
                "accessor": function ({ instance }: any) {
                    return instance?.description || "";
                },
            },
        ],
        [
            {
                "_comment": "name of the agent that owns the tool call",
                "attribute": "name",
                "accessor": function ({ args }: any) {
                    return args?.[0]?.toolContext?.invocationContext?.agent?.name || "";
                },
            },
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
                    "_comment": "validated args the model produced for this tool call",
                    "attribute": "Inputs",
                    "accessor": function ({ args }: any) {
                        const toolArgs = args?.[0]?.args;
                        return toolArgs ? [JSON.stringify(toolArgs)] : [""];
                    },
                },
            ],
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "tool execution result",
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

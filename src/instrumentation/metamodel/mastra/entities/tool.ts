import { SPAN_SUBTYPES, SPAN_TYPES } from "../../../common/constants";
import { getExceptionMessage } from "../../utils";

const MASTRA_TOOL_TYPE = "tool.mastra";
const MASTRA_AGENT_TYPE = "agent.mastra";

export const TOOL = {
    "type": SPAN_TYPES.AGENTIC_TOOL_INVOCATION,
    "subtype": SPAN_SUBTYPES.CONTENT_GENERATION,
    "attributes": [
        [
            {
                "_comment": "tool type",
                "attribute": "type",
                "accessor": function () {
                    return MASTRA_TOOL_TYPE;
                },
            },
            {
                "_comment": "tool id, e.g. get-weather",
                "attribute": "name",
                "accessor": function ({ instance }: any) {
                    return instance?.id || "";
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
                "_comment": "owning agent, stamped onto the tool by mastraToolWrapper",
                "attribute": "name",
                "accessor": function ({ instance }: any) {
                    return instance?.__monocleAgent?.name || "";
                },
            },
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return MASTRA_AGENT_TYPE;
                },
            },
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "args the model produced for this tool call",
                    "attribute": "Inputs",
                    "accessor": function ({ args }: any) {
                        const toolArgs = args?.[0];
                        return toolArgs === undefined || toolArgs === null
                            ? [""]
                            : [JSON.stringify(toolArgs)];
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

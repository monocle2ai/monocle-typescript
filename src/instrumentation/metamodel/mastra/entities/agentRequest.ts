import { SPAN_SUBTYPES } from "../../../common/constants";
import { extractAgentName, extractFinalText, extractUserInput } from "./messages";

const MASTRA_AGENT_TYPE = "agent.mastra";

export const AGENT_REQUEST = {
    "type": "agentic.turn",
    "subtype": SPAN_SUBTYPES.TURN,
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
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "user message(s) passed into agent.generate / agent.stream",
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
                    "_comment": "final assistant response for the turn",
                    "attribute": "response",
                    "accessor": function ({ response, exception }: any) {
                        return extractFinalText({ response, exception });
                    },
                },
            ],
        },
        // Token usage intentionally omitted: this is an agentic turn span, not
        // an inference span. Tokens belong on the future inference span.
    ],
};

import { SPAN_SUBTYPES, SPAN_TYPES } from "../../../common/constants";
import { AGENTS_AGENT_TYPE, extractRunInput, extractRunOutput } from "../agentsHelper";

// One Runner.run call = one agentic turn, the outermost agents span. Typed
// agentic.turn to match the ADK and Mastra request spans.
// Args are Runner.run's own: (agent, input, options?).
export const AGENT_REQUEST = {
    "type": SPAN_TYPES.AGENTIC_TURN,
    "subtype": SPAN_SUBTYPES.TURN,
    "attributes": [
        [
            {
                "_comment": "agentic framework",
                "attribute": "type",
                "accessor": function () {
                    return AGENTS_AGENT_TYPE;
                }
            }
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "input passed into Runner.run",
                    "attribute": "input",
                    "accessor": function ({ args }: any) {
                        return extractRunInput(args);
                    }
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "final output of the run",
                    "attribute": "response",
                    "accessor": function ({ response }: any) {
                        return extractRunOutput(response);
                    }
                }
            ]
        }
    ]
};

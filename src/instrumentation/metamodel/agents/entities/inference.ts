import { context } from "@opentelemetry/api";
import { AGENT_REQUEST_SPAN_NAME, SPAN_SUBTYPES, SPAN_TYPES } from "../../../common/constants";
import { extractAssistantMessage, getExceptionMessage } from "../../utils";

// const DELEGATION_NAME_PREFIX = "transfer_to_"
const ROOT_AGENT_NAME = "AgentsSDK"
const AGENTS_AGENT_NAME_KEY = "agent.openai_agents"
export const AGENTS_AGENT_NAME_KEY_SYMBOL = Symbol("agent.openai_agents");



export const AGENT = {
    "type": SPAN_TYPES.AGENTIC_INVOCATION,
    "subtype": SPAN_SUBTYPES.ROUTING,
    "attributes": [
        [
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return AGENTS_AGENT_NAME_KEY;
                }
            },
            {
                "_comment": "name of the agent",
                "attribute": "name",
                "accessor": function ({ args }) {
                    if (args && args.length > 0) {
                        return args[0]?.name || ROOT_AGENT_NAME;
                    }
                    return "mcp.server";
                }
            },
            {
                "_comment": "agent description",
                "attribute": "description",
                "accessor": function ({ args }) {

                    return args[0]?.description || args[0]?.handoffDescription || "";


                }
            },
            {
                "_comment": "agent instructions",
                "attribute": "instructions",
                "accessor": function ({ args }) {
                    return args[0]?.instructions || "";
                }
            }
        ]
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [

                {
                    "_comment": "this is Agent input",
                    "attribute": "query",
                    "accessor": function ({ args }: any): any {
                        return JSON.stringify(args[1]) || JSON.stringify(args);

                    }
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "this is response from Agent",
                    "attribute": "response",
                    "accessor": function ({ response }) {
                        return JSON.stringify(response.state.modelResponses().output[0].content[0].text) || "";
                    }
                },
                {
                    "name": "metadata",
                    "attributes": [
                        {
                            "_comment": "this is metadata from Agent response",
                            "accessor": function ({ response }) {
                                try {
                                    const metadata = {
                                        "inputTokens": response.state.modelResponses().usage.inputTokens,
                                        "outputTokens": response.state.modelResponses().usage.outputTokens,
                                        "totalTokens": response.state.modelResponses().usage.totalTokens
                                    }
                                    return JSON.stringify(metadata) || "";
                                }
                                catch (e) {
                                    console.warn(`Warning: Error extracting metadata: ${e}`);
                                    return JSON.stringify({});
                                }
                            }
                        }
                    ],
                },
            ]
        }
    ]
}


export const AGENT_REQUEST = {
    "type": AGENT_REQUEST_SPAN_NAME,
    "subtype": SPAN_SUBTYPES.PLANNING,
    "attributes": [
        [
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return AGENTS_AGENT_NAME_KEY;
                },
            }
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "this is Agent input",
                    "attribute": "input",
                    "accessor": function ({ args }) {
                        return JSON.stringify(args[1]) || "";
                    },
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "this is response from Agent",
                    "attribute": "response",
                    "accessor": function ({ response }) {
                        return JSON.stringify(response.finalOutput) || "";

                    },

                }
            ]
        }
    ]
}


export const TOOLS = {
    "type": SPAN_TYPES.AGENTIC_TOOL_INVOCATION,
    "subtype": SPAN_SUBTYPES.ROUTING,
    "attributes": [
        [
            {
                "_comment": "tool type",
                "attribute": "type",
                "accessor": function () {
                    // check for mcp
                    return "tool.openai_agents";
                }
            },
            {
                "_comment": "name of the tool",
                "attribute": "name",
                "accessor": function ({ args }) {
                    return args[0]?.name || "";
                }
            },
            {
                "_comment": "tool description",
                "attribute": "description",
                "accessor": function ({ args }) {
                    return args[0]?.description || "";

                }
            }
        ],
        [
            {
                "_comment": "name of the agent",
                "attribute": "name",
                "accessor": function () {
                    let currentContext = context.active();
                    const from_agent = currentContext.getValue(AGENTS_AGENT_NAME_KEY_SYMBOL);
                    return from_agent || "";

                }
            },
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return AGENTS_AGENT_NAME_KEY;
                },
            }
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "this is Tool input",
                    "attribute": "Inputs",
                    "accessor": function ({ args }) {
                        if (args && args[0]) {
                            return [JSON.stringify(args[0].args)];
                        }
                        return [""];
                    }
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "this is response from LLM",
                    "attribute": "response",
                    "accessor": function ({ response, exception }) {
                        if (exception) {
                            return getExceptionMessage({ exception });
                        }
                        if (response) {
                            return extractAssistantMessage(response);
                        }
                        return JSON.stringify(response || "");
                    }
                }
            ]
        }
    ]
}


export const AGENT_DELEGATION = {
    "type": SPAN_TYPES.AGENTIC_DELEGATION,
    "subtype": SPAN_SUBTYPES.ROUTING,
    "attributes": [
        [
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return AGENTS_AGENT_NAME_KEY;
                },
            },
            {
                "_comment": "name of the agent",
                "attribute": "from_agent",
                "accessor": function () {
                    let currentContext = context.active();
                    const from_agent = currentContext.getValue(AGENTS_AGENT_NAME_KEY_SYMBOL);
                    return from_agent || "";
                },
            },
            {
                "_comment": "name of the agent calle",
                "attribute": "to_agent",
                "accessor": function ({ args, instance }) {
                    if (args && args.length > 0) {
                        return args[0]?.name || args[0]?.agent?.name || "";
                    }
                    return instance?.name || "";
                },
            }
        ],
    ],
}
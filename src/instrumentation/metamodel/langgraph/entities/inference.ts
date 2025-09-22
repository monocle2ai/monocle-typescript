import {
    extractAssistantMessage,
    getExceptionMessage,
} from "../../utils";
import { AGENT_REQUEST_SPAN_NAME, DELEGATION_NAME_PREFIX, LANGGRAPH_AGENT_NAME_KEY, SPAN_SUBTYPES, SPAN_TYPES } from "../../../common/constants";
import { context } from "@opentelemetry/api";

export const AGENT = {
    "type": SPAN_TYPES.AGENTIC_INVOCATION,
    "subtype": SPAN_SUBTYPES.ROUTING,
    "attributes": [
        [
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return "agent.langgraph";
                },
            },
            {
                "_comment": "name of the agent",
                "attribute": "name",
                "accessor": function ({ instance }) {
                    return (
                        instance?.name || instance?.constructor?.name || ""
                    );
                },
            },
            {
                "_comment": "agent description",
                "attribute": "description",
                "accessor": function ({ instance }) {
                    let toolNames = [];
                    if (toolNames.length === 0 && instance?.nodes?.tools?.bound?.tools) {
                        if (Array.isArray(instance.nodes.tools.bound.tools)) {
                            toolNames = instance.nodes.tools.bound.tools.map(tool => {
                                return tool.name || tool.lc_kwargs?.name || tool.func?.name || tool.description || 'unknown_tool';
                            }).filter(name => name !== 'unknown_tool');
                        } else {
                            const nodeNames = Object.keys(instance.nodes.tools.bound.tools).filter(name =>
                                name !== "__start__" && name !== "agent"
                            );
                            toolNames = nodeNames;
                        }
                    }

                    return toolNames.length > 0 ? toolNames : [];
                },
            },
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "this is Agent input",
                    "attribute": "query",
                    "accessor": function ({ args }) {
                        let input = "";
                        if (args?.[0]?.messages && Array.isArray(args[0].messages)) {
                            const messages = args[0].messages;
                            const userMessages = messages.filter(
                                (msg) =>
                                    msg.content &&
                                    (msg.role === "user" ||
                                        msg.role === "human" ||
                                        msg.constructor?.name === "HumanMessage")
                            );
                            if (userMessages.length > 0) {
                                input = userMessages.map((msg) => msg.content).join("; ");
                            } else {
                                input = JSON.stringify(messages);
                            }
                        }
                        return input;
                    },
                },
            ],
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "LangGraph output state or response",
                    "attribute": "response",
                    "accessor": function ({ response, exception }) {
                        if (response?.messages && Array.isArray(response.messages)) {
                            for (let i = response.messages.length - 1; i >= 0; i--) {
                                const message = response.messages[i];
                                if (
                                    message.constructor?.name === "AIMessage" &&
                                    message.content &&
                                    message.content.trim()
                                ) {
                                    return message.content;
                                }
                            }
                        }
                        if (exception) {
                            return getExceptionMessage({ exception });
                        }
                        return "";
                    },
                }
            ],
        },
    ],
};



export const AGENT_REQUEST = {
    "type": AGENT_REQUEST_SPAN_NAME,
    "subtype": SPAN_SUBTYPES.PLANNING,
    "attributes": [
        [
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return "agent.langgraph";
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
                        if (args?.[0]?.messages) {
                            const message = args[0].messages[0];
                            if (message?.["content"] && message?.["role"] && message["content"] == "user")
                                return message["content"];

                        }
                        return "";
                    },
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "this is response from LLM",
                    "attribute": "response",
                    "accessor": function ({ response }) {
                        if (response?.messages && Array.isArray(response.messages)) {
                            return JSON.stringify(response.messages[response.messages.length - 1].content);
                        }
                        return "";
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
                    return "tool.langgraph";
                }
            },
            {
                "_comment": "name of the tool",
                "attribute": "name",
                "accessor": function ({ instance }) {
                    return instance?.name || "";
                }
            },
            {
                "_comment": "tool description",
                "attribute": "description",
                "accessor": function ({ instance }) {
                    if (instance?.description) {
                        return instance.description;
                    }
                    return "";
                }
            }
        ],
        [
            {
                "_comment": "name of the agent",
                "attribute": "name",
                "accessor": function ({ instance }) {

                    if (instance?.graph?.name) {
                        return instance.graph.name;
                    }

                    if (instance?.agent?.name) {
                        return instance.agent.name;
                    }

                    if (instance?.runnable?.name) {
                        return instance.runnable.name;
                    }

                    if (instance?.constructor?.name &&
                        instance.constructor.name !== 'Object' &&
                        instance.constructor.name !== 'Function') {
                        return instance.constructor.name;
                    }

                    return "";
                }
            },
            {
                "_comment": "agent type",
                "attribute": "type",
                "accessor": function () {
                    return "agent.langchain";
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
                    return "agent.langgraph";
                },
            },
            {
                "_comment": "name of the agent",
                "attribute": "from_agent",
                "accessor": function () {
                    let currentContext = context.active();
                    const from_agent = currentContext.getValue(LANGGRAPH_AGENT_NAME_KEY);
                    return from_agent || "";
                },
            },
            {
                "_comment": "name of the agent calle",
                "attribute": "to_agent",
                "accessor": function (instance) {
                    const tool = instance.instance.name
                    return tool.replace(DELEGATION_NAME_PREFIX.description, "");
                },
            }
        ],
    ],
}



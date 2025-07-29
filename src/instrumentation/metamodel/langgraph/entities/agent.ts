import {
    getExceptionMessage,
    getStatus,
    getStatusCode,
} from "../../utils";

export const config = {
    type: "agent",
    attributes: [
        [
            {
                _comment: "agent type",
                attribute: "type",
                accessor: function () {
                    return "agent.aoi";
                },
            },
            {
                _comment: "name of the agent",
                attribute: "name",
                accessor: function ({ instance }) {
                    return (
                        instance?.name || instance?.constructor?.name || "langgraph_agent"
                    );
                },
            },
            {
                _comment: "agent tools",
                attribute: "tools",
                accessor: function ({ instance }) {
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
    events: [
        {
            name: "data.input",
            attributes: [
                {
                    _comment: "this is LLM input",
                    attribute: "input",
                    accessor: function ({ args }) {
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
            name: "data.output",
            attributes: [
                {
                    _comment: "LangGraph output state or response",
                    attribute: "response",
                    accessor: function ({ response, exception }) {
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
                },
                {
                    attribute: "status",
                    accessor: (args) => {
                        return getStatus(args);
                    },
                },
                {
                    attribute: "status_code",
                    accessor: (args) => {
                        return getStatusCode(args);
                    },
                },
            ],
        },
        {
            name: "metadata",
            attributes: [
                {
                    _comment: "this is response metadata from LLM",
                    accessor: function ({ response }) {
                        if (response?.messages && Array.isArray(response.messages)) {
                            for (let i = response.messages.length - 1; i >= 0; i--) {
                                const message = response.messages[i];
                                if (
                                    message.constructor?.name === "AIMessage" &&
                                    message.content &&
                                    message.content.trim()
                                ) {
                                    const tokenUsage = message.response_metadata?.tokenUsage;
                                    if (tokenUsage) {
                                        return {
                                            completion_tokens: tokenUsage.completionTokens,
                                            prompt_tokens: tokenUsage.promptTokens,
                                            total_tokens: tokenUsage.totalTokens
                                        };
                                    }
                                    return {};
                                }
                            }
                        }
                        return {};
                    },
                },
            ],
        },
    ],
};
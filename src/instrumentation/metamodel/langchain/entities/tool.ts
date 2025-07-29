import {
    extractAssistantMessage,
    getExceptionMessage,
    getStatus,
    getStatusCode,
} from "../../utils";

export const config = {
    type: "tool",
    attributes: [
        [
            {   
                _comment: "tool type",
                attribute: "type",
                accessor: function () {
                    return `tool.langchain`;
                }
            },
            {
                _comment: "name of the tool",
                attribute: "name",
                accessor: function ({ instance }) {
                    return instance?.name || "";
                }
            },
            {
                _comment: "description of the tool",
                attribute: "description",
                accessor: function ({ instance }) {
                    if (instance?.description) {
                        return instance.description;
                    }
                    return "";
                }
            },
            
        ],
        [
            {
                _comment: "type of the agent",
                attribute: "type",
                accessor: function () {
                    return `agent.langchain`;
                }
            },
            {
                _comment: "name of the agent",
                attribute: "name",
                accessor: function ({ instance }) {
                    
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
            }
        ],
    ],
    events: [
        {
            name: "data.input",
            attributes: [
                {
                    _comment: "Tool input parameters",
                    attribute: "input",
                    accessor: function ({ args }) {
                        if (args && args[0]) {
                            return [JSON.stringify(args[0].args)];
                        }
                        return [""];
                    }
                }
            ]
        },
        {
            name: "data.output",
            attributes: [
                {
                    _comment: "Tool execution result",
                    attribute: "response",
                    accessor: function ({ response, exception }) {
                        if (exception) {
                            return getExceptionMessage({ exception });
                        }
                        if (response) {
                            return extractAssistantMessage(response);
                        }
                        return JSON.stringify(response || "");
                    }
                },
                {
                    attribute: "status",
                    accessor: (args) => {
                        return getStatus(args);
                    }
                },
                {
                    attribute: "status_code",
                    accessor: (args) => {
                        return getStatusCode(args);
                    }
                }
            ]
        }
    ]
};

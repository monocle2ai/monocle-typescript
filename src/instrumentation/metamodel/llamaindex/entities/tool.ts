import {
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
                accessor: function() {
                    return `tool.llamaindex`;
                }
            },
            {
                _comment: "name of the tool",
                attribute: "name",
                accessor: function ({ args }) {
                    if (args && args.length > 0) {
                        const firstArg = args[0];
                        if (firstArg && typeof firstArg === 'object' && 
                            'data' in firstArg && firstArg.data && 
                            typeof firstArg.data === 'object' && 'toolName' in firstArg.data) {
                            return firstArg.data.toolName;
                        }
                    }

                    return "";
                }
            },
            {
                 _comment: "description of the tool",
                attribute: "description",
                accessor: function ({ instance, args }) {
                    // Try to get the specific tool description from the arguments first
                    if (args && args.length > 0) {
                        const firstArg = args[0];
                        // Check if it's an AgentToolCall with data.toolName
                        if (firstArg && typeof firstArg === 'object' && 
                            'data' in firstArg && firstArg.data && 
                            typeof firstArg.data === 'object' && 'toolName' in firstArg.data) {
                            const targetToolName = firstArg.data.toolName;
                            
                            // Look for the tool with this name in the agent's tools
                            if (instance?.agents && instance.agents.size > 0) {
                                const firstAgent = instance.agents.values().next().value;
                                if (firstAgent?.tools && Array.isArray(firstAgent.tools)) {
                                    const matchingTool = firstAgent.tools.find(tool => {
                                        const toolName = tool?.metadata?.name || tool?.name;
                                        return toolName === targetToolName;
                                    });
                                    
                                    if (matchingTool) {
                                        return matchingTool?.metadata?.description || 
                                               matchingTool?.description || 
                                               `Tool: ${targetToolName}`;
                                    }
                                }
                            }
                            
                            return `Tool: ${targetToolName}`;
                        }
                    }
                    
                    // Fallback to instance description
                    return instance?.metadata?.description || "";
                }
            },
            
        ],
        [
            {
                _comment: "type of the agent",
                attribute: "type",
                accessor: function () {
                    return `agent.llamaindex`;
                }
            },
            {
                _comment: "name of the agent",
                attribute: "name",
                accessor:  function ({ instance }) {
                    if (instance?.agents && instance.agents.size > 0) {
                        const firstAgent = instance.agents.values().next().value;
                        return firstAgent?.name || firstAgent?.constructor?.name || "";
                    }
                    return instance?.constructor?.name || "AgentWorkflow";
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
                            return [JSON.stringify(args[0].data.toolKwargs)];
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
                        if (typeof response === "string") {
                            return response;
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

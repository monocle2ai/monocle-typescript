function extractMessages(args) {
    /**
     * Extract system and user messages
     */
    try {
        let systemMessage = "";
        let userMessage = "";

        if (args && args.length > 0) {
            if (args[0].messages && Array.isArray(args[0].messages)) {
                for (const msg of args[0].messages) {
                    if ('content' in msg && 'role' in msg) {
                        if (msg.role === "system") {
                            systemMessage = msg.content;
                        } else if (["user", "human"].includes(msg.role)) {
                            userMessage = msg.content;
                        }
                    }
                }
            } else if (Array.isArray(args[0])) {
                for (const msg of args[0]) {
                    if ('content' in msg && 'role' in msg) {
                        if (msg.role === "system") {
                            systemMessage = msg.content;
                        } else if (["user", "human"].includes(msg.role)) {
                            userMessage = extractQueryFromContent(msg.content);
                        }
                    }
                }
            }
        }
        return [systemMessage, userMessage];
    } catch (e) {
        console.warn(`Warning: Error occurred in extractMessages: ${e.toString()}`);
        return ["", ""];
    }
}

function extractQueryFromContent(content) {
    try {
        const queryPrefix = "Query:";
        const answerPrefix = "Answer:";
        
        const queryStart = content.indexOf(queryPrefix);
        if (queryStart === -1) {
            return null;
        }

        const actualQueryStart = queryStart + queryPrefix.length;
        const answerStart = content.indexOf(answerPrefix, actualQueryStart);
        
        const query = answerStart === -1 
            ? content.slice(actualQueryStart).trim()
            : content.slice(actualQueryStart, answerStart).trim();
            
        return query;
    } catch (e) {
        console.warn(`Warning: Error occurred in extractQueryFromContent: ${e.toString()}`);
        return "";
    }
}

function extractAssistantMessage(response) {
    try {
        if (typeof response === 'string') {
            return response;
        }
        
        if ('content' in response) {
            return response.content;
        }
        
        if (response.message && 'content' in response.message) {
            return response.message.content;
        }
        
        if ('replies' in response) {
            if ('content' in response.replies[0]) {
                return response.replies[0].content;
            } else {
                return response.replies[0];
            }
        }
        
        return "";
    } catch (e) {
        console.warn(`Warning: Error occurred in extractAssistantMessage: ${e.toString()}`);
        return "";
    }
}

exports.config = {
    "type": "inference",
    "attributes": [
        [
            {
                "_comment": "provider type ,name , deployment , inference_endpoint",
                "attribute": "type",
                "accessor": function ({ instance }) {
                    if (instance?.constructor?.name?.toLowerCase().includes("azurechatopenai")) {
                        return "inference.azure_openai"
                    }
                    if (instance?.constructor?.name?.toLowerCase().includes("chatopenai")) {
                        return "inference.openai"
                    }
                }
            },
            {
                "attribute": "deployment",
                "accessor": function ({ instance }) {
                    return instance.engine || instance.deployment || instance.deployment_name || instance.deployment_id || instance.azure_deployment
                }
            },
            {
                "attribute": "inference_endpoint",
                "accessor": function ({ instance }) {
                    return instance.azure_endpoint || instance.api_base || instance?.client?.baseURL
                }
            }
        ],
        [
            {
                "_comment": "LLM Model",
                "attribute": "name",
                "accessor": function ({ instance }) {
                    return instance.model_name || instance.model
                }
            },
            {
                "attribute": "type",
                "accessor": function ({ instance }) {
                    return "model.llm" + (instance.model_name || instance.model)
                }
            }
        ]
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [

                {
                    "_comment": "this is instruction to LLM",
                    "attribute": "system",
                    "accessor": function ({
                        args,
                        // instance 
                    }) {
                        return extractMessages(args)[0]
                    }
                },
                {
                    "_comment": "this is user instruction to LLM",
                    "attribute": "user",
                    "accessor": function ({
                        args,
                        // instance 
                    }) {
                        return extractMessages(args)[1]
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
                    "accessor": function ({ response }) {
                        return extractAssistantMessage(response)
                    }
                }
            ]
        },
    ]
}

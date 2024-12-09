const { extractMessages, extractAssistantMessage } = require("../utils.js")   

exports.config = {
    "type": "inference",
    "attributes": [
        [
            {
                "_comment": "provider type ,name , deployment , inference_endpoint",
                "attribute": "type",
                "accessor": function ({ instance }) {
                    const constructorName = instance?.constructor?.name?.toLowerCase()
                    if (
                        constructorName?.includes("azurechatopenai") || constructorName?.includes("azureopenai")) {
                        return "inference.azure_openai"
                    }
                    if (constructorName?.includes("chatopenai") || constructorName?.includes("openai")) {
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
                    return instance.azure_endpoint || instance.api_base || instance?.client?.baseURL || instance?.session?.openai?.baseURL
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

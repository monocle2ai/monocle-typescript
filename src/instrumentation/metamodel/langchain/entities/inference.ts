import { extractAssistantMessage, getExceptionMessage, getLlmMetadata, getStatus, getStatusCode } from "../../utils"

export const config = {
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
                    return "";
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
                    return "model.llm." + (instance.model_name || instance.model)
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
                    "attribute": "input",
                    "accessor": function ({
                        args,
                        // instance 
                    }) {
                        return [args[0].value || args[0] || "" ]
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
                        if (exception){
                            return getExceptionMessage({ exception });
                        }
                        return [extractAssistantMessage(response)]
                    }
                },
                {
                    "attribute": "status",
                    "accessor": (args) => {
                        return getStatus(args);
                    }
                },
                {
                    "attribute": "status_code",
                    "accessor": (args) => {
                        return getStatusCode(args);
                    }
                },
            ]
        },
        {
            "name": "metadata",
            "attributes": [

                {
                    "_comment": "this is response metadata from LLM",
                    "accessor": function ({ instance, response }) {
                        return getLlmMetadata({ response, instance })
                    }
                }
            ]
        },
    ]
}

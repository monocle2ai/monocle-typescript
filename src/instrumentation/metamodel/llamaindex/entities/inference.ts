import { extractMessages, extractAssistantMessage, getLlmMetadata } from "../../utils"   

export const config = {
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
                    "_comment": "this is input to LLM",
                    "attribute": "input",
                    "accessor": function ({
                        args,
                        // instance 
                    }) {
                        const response = extractMessages(args)
                        const retValue: string[] = []
                        if(response && response[1]){
                            retValue.push(response[1])
                        }
                        if(response && response[0]){
                            retValue.push(response[0])
                        }
                        return retValue
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
                        return [extractAssistantMessage(response)]
                    }
                }
            ]
        },
        {
            "name": "metadata",
            "attributes": [

                {
                    "_comment": "this is response metadata from LLM",
                    "accessor": function ({ instance, response }) {
                        return getLlmMetadata({response, instance})
                    }
                }
            ]
        },
    ]
}

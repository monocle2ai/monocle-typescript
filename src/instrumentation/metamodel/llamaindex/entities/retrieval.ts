import { extractAssistantMessage, getExceptionMessage, getStatus, getStatusCode } from "../../utils"   

export const config = {
    "type": "retrieval",
    "attributes": [
        [
            {
                "_comment": "vector store name",
                "attribute": "name",
                "accessor": function ({ instance, /*args*/ }) {
                    return instance?.index?.vectorStores?.TEXT?.constructor.name
                }
            },
            {
                "attribute": "type",
                "accessor": function ({ instance }) {
                    return "vectorstore." + instance?.index?.vectorStores?.TEXT?.constructor.name
                }
            },
            {
                "attribute": "deployment",
                "accessor": function ({  }) {
                    return ""
                }
            }
        ],
        [
            {
                "_comment": "Embedding model name",
                "attribute": "name",
                "accessor": function ({ instance }) {
                    return instance.index.vectorStores.TEXT.embedModel.model
                }
            },
            {
                _comment: "Embedding model type",
                "attribute": "type",
                "accessor": function ({ instance }) {
                    return "model.embedding." + instance.index.vectorStores.TEXT.embedModel.model
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
                        if(typeof args[0] === "string") {
                            return [args[0]]
                        }
                        return []
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
                        return extractAssistantMessage(response)
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
    ]
}

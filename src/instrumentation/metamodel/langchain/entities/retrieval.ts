import { extractAssistantMessage, getExceptionMessage, getStatus, getStatusCode } from "../../utils"

export const config = {
    "type": "retrieval",
    "attributes": [
        [
            {
                "_comment": "vector store name",
                "attribute": "name",
                "accessor": function ({ instance, /*args*/ }) {
                    if (instance?.vectorStore?.constructor?.name) {
                        return instance?.vectorStore?.constructor?.name
                    }
                }
            },
            {
                "attribute": "type",
                "accessor": function ({ instance }) {
                    if (instance?.vectorStore?.constructor?.name) {
                        return "vectorstore." + instance?.vectorStore?.constructor?.name
                    }
                    return "";
                }
            },
            {
                "attribute": "deployment",
                "accessor": function ({ /*instance, args*/ }) {
                    return ""
                }
            }
        ],
        [
            {
                "_comment": "Embedding model name",
                "attribute": "name",
                "accessor": function ({ instance }) {
                    return instance.vectorStore.embeddings.model
                }
            },
            {
                _comment: "Embedding model type",
                "attribute": "type",
                "accessor": function ({ instance }) {
                    return "model.embedding." + instance.vectorStore.embeddings.model
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
                        if (args[0].value && typeof args[0].value === "string") {
                            return args[0].value
                        }
                        if (args[0] && typeof args[0] === "string") {
                            return args[0]
                        }
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

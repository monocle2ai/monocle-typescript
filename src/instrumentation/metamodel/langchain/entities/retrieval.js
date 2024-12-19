const { extractAssistantMessage } = require("../../utils")   

exports.config = {
    "type": "retrieval",
    "attributes": [
        [
            {
                "_comment": "vector store name",
                "attribute": "name",
                "accessor": function ({ instance, args }) {
                    if (instance?.vectorStore?.constructor?.name) {
                        return instance?.vectorStore?.constructor?.name
                    }
                }
            },
            {
                "attribute": "vector store type",
                "accessor": function ({ instance }) {
                    if (instance?.vectorStore?.constructor?.name) {
                        return "vectorstore." + instance?.vectorStore?.constructor?.name
                    }
                }
            },
            {
                "attribute": "deployment",
                "accessor": function ({ instance, args }) {
                    return ""
                }
            }
        ],
        [
            {
                "_comment": "Embedding model name",
                "attribute": "name",
                "accessor": function ({ instance }) {
                    return instance.instance.vectorStore.embeddings.model
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
                    "attribute": "user",
                    "accessor": function ({
                        args,
                        // instance 
                    }) {
                        return args[0].value
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
                        extractAssistantMessage(response)
                    }
                }
            ]
        },
    ]
}

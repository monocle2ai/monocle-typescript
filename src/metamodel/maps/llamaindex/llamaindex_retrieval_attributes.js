const { extractAssistantMessage } = require("../utils.js")

exports.config = {
    "type": "retrieval",
    "attributes": [
        [
            {
                "_comment": "vector store name",
                "attribute": "name",
                "accessor": function ({ instance, args }) {
                    return instance?.index?.vectorStores?.TEXT?.constructor.name
                }
            },
            {
                "attribute": "vector store type",
                "accessor": function ({ instance }) {
                    return "vectorstore." + instance?.index?.vectorStores?.TEXT?.constructor.name
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

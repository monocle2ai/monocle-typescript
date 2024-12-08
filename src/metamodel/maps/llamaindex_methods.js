exports.config = [
    {
        "package": "llamaindex",
        "object": "VectorIndexRetriever",
        "method": "retrieve",

    },
    {
        "package": "llamaindex",
        "object": "RetrieverQueryEngine",
        "method": "query",

    },
    {
        "package": "llamaindex",
        "object": "OpenAI",
        "method": "chat",
        "spanName": "llamaindex.openai_chat",
        "output_processor": [
           require("./attributes/llamaindex_attributes.js").config
        ]

    },
]
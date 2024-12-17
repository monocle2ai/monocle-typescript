exports.config = [
    {
        "package": "llamaindex",
        "object": "VectorIndexRetriever",
        "method": "retrieve",
        "spanName": "llamaindex.vector_retrieval",
        output_processor: [
            require("./llamaindex_retrieval_attributes.js").config
        ]

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
           require("./llamaindex_attributes.js").config
        ]

    },
]
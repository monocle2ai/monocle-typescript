export const config = [
    {
        "package": "llamaindex",
        "object": "VectorIndexRetriever",
        "method": "retrieve",
        "spanName": "llamaindex.vector_retrieval",
        output_processor: [
            require("./entities/retrieval.js").config
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
           require("./entities/inference.js").config
        ]

    },
    {
        "package": "llamaindex",
        "object": "BaseLLM",
        "method": "complete",
        "spanName": "llamaindex.llm_chat",
        "output_processor": [
           require("./entities/inference.js").config
        ]

    },
]
import { config as retrievalConfig } from "./entities/retrieval";
import { config as inferenceConfig } from "./entities/inference";

export const config = [
    {
        "package": "llamaindex",
        "object": "VectorIndexRetriever",
        "method": "retrieve",
        "spanName": "llamaindex.vector_retrieval",
        output_processor: [
            retrievalConfig
        ]
    },
    {
        "package": "llamaindex",
        "object": "RetrieverQueryEngine",
        "method": "query",
    },
    {
        "package": "llamaindex",
        "object": "BaseLLM",
        "method": "complete",
        "spanName": "llamaindex.llm_chat",
        "output_processor": [
           inferenceConfig
        ]
    },
]
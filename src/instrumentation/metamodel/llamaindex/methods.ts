import { config as retrievalConfig } from "./entities/retrieval.js";
import { config as inferenceConfig } from "./entities/inference.js";

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
        "spanType": "workflow"
    },
    {
        "package": "llamaindex",
        "object": "OpenAI",
        "method": "chat",
        "spanName": "llamaindex.openai_chat",
        "output_processor": [
           inferenceConfig
        ]
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
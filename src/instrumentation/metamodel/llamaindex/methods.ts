import { config as retrievalConfig } from "./entities/retrieval";
import { config as inferenceConfig } from "./entities/inference";
import { config as agentConfig } from "./entities/agent";

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
    {
        "package": "@llamaindex/workflow",
        "object": "AgentWorkflow",
        "method": "run",
        "spanName": "llamaindex.multi_agent",
        "output_processor": [
            agentConfig
        ]
    }
]
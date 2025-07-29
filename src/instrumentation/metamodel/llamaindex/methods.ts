import { config as retrievalConfig } from "./entities/retrieval";
import { config as inferenceConfig } from "./entities/inference";
import { config as agentConfig } from "./entities/agent";
import { config as toolConfig } from "./entities/tool";

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
    },
    {
        "package": "@llamaindex/workflow",
        "object": "AgentWorkflow",
        "method": "callTool",
        "spanName": "llamaindex.tool_call",
        "output_processor": [
            toolConfig
        ]
    },
    {
        "package": "@llamaindex/openai",
        "object": "OpenAI",
        "method": "chat",
        "spanName": "llamaindex.openai.chat",
        "output_processor": [
            inferenceConfig
        ]
    }
]
import { config as inferenceConfig } from "./entities/inference";
import { config as retrievalConfig } from "./entities/retrieval";

export const config = [
    {
        "package": "@langchain/core/language_models/chat_models",
        "object": "BaseChatModel",
        "method": "invoke",
        "spanName": "langchain.chat",
        "output_processor": [
            inferenceConfig
        ]
    },
    {
        "package": "@langchain/core/runnables",
        "object": "RunnableParallel",
        "method": "invoke",
        "spanName": "langchain.parallel",
        "spanType": "workflow"
    },
    {
        "package": "@langchain/core/runnables",
        "object": "RunnableSequence",
        "method": "invoke",
        "spanName": "langchain.sequence",
        "spanType": "workflow"
    },
    {
        "package": "@langchain/core/vectorstores",
        "object": "VectorStoreRetriever",
        "method": "_getRelevantDocuments",
        "spanName": "langchain.vectorstore_retriever",
        "output_processor": [
            retrievalConfig
        ]
    },
    {
        "package": "@langchain/core/prompts",
        "object": "BaseChatPromptTemplate",
        "method": "invoke",
        "spanName": "langchain.prompt_template",
        "spanType": "workflow"
    },
    {
        "package": "@langchain/core/prompts",
        "object": "PromptTemplate",
        "method": "format",
        "spanName": "langchain.prompt_template.format",
        "spanType": "workflow"
    }
]
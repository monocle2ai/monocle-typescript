exports.config = [
    {

        "package": "@langchain/core/language_models/chat_models",
        "object": "BaseChatModel",
        "method": "invoke",
        "spanName": "langchain.chat",
        "output_processor": [
           require("./langchain_attributes.js").config
        ]
    },
    {

        "package": "@langchain/core/runnables",
        "object": "RunnableParallel",
        "method": "invoke",
        "spanName": "langchain.parallel"
    },
    {

        "package": "@langchain/core/runnables",
        "object": "RunnableSequence",
        "method": "invoke",
        "spanName": "langchain.sequence",
    },
    {
        "package": "@langchain/core/vectorstores",
        "object": "VectorStoreRetriever",
        "method": "_getRelevantDocuments",
        "spanName": "langchain.vectorstore_retriever",
        "output_processor": [
            require("./langchain_retrieval_attributes.js").config
        ]
    },
    {
        "package": "@langchain/core/prompts",
        "object": "BaseChatPromptTemplate",
        "method": "invoke",
        "spanName": "langchain.prompt_template",
    },
    {
        "package": "@langchain/core/prompts",
        "object": "PromptTemplate",
        "method": "format",
        "spanName": "langchain.prompt_template.format",
    }
]
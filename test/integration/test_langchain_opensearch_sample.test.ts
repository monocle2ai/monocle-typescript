import path from "path";
import fs from "fs";

import { describe, beforeAll, expect, test } from "vitest";

import { OpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";

import { PromptTemplate } from "@langchain/core/prompts";
const { StringOutputParser } = require("@langchain/core/output_parsers");
import { TextLoader } from "langchain/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenSearchVectorStore } from "@langchain/community/vectorstores/opensearch";
const { RunnablePassthrough } = require("@langchain/core/runnables");

import {
  ChatPromptTemplate,
  MessagesPlaceholder
} from "@langchain/core/prompts";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { Client } from "@opensearch-project/opensearch";
import { CustomConsoleSpanExporter } from "../common/custom_exporter";
import { setupMonocle } from "../../dist";

describe("LangChain OpenSearch Integration", () => {
  let customExporter: CustomConsoleSpanExporter;

  beforeAll(() => {
    customExporter = new CustomConsoleSpanExporter();
    setupMonocle("langchain_opensearch");

    // Create test data directory and sample file if they don't exist
    const myPath = path.resolve(__dirname);
    const dataDir = path.join(myPath, "..", "data");
    const sampleFilePath = path.join(dataDir, "sample.txt");

    // Create data directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Create sample.txt with test content if it doesn't exist
    if (!fs.existsSync(sampleFilePath)) {
      const sampleContent = `
Task Decomposition is the process of breaking down complex tasks into smaller, more manageable subtasks.
This technique is particularly useful in AI and programming when solving complex problems.
Task Decomposition helps in better organization, parallel execution, and simpler debugging of code.
It allows teams to work on different components simultaneously and improves overall efficiency.

When implementing Task Decomposition:
1. Identify the main problem or task
2. Break it down into logical subtasks
3. Determine dependencies between subtasks
4. Assign priorities to each subtask
5. Implement solutions for each subtask
6. Integrate the solutions back together

Task Decomposition is commonly used in Agile methodologies, AI planning systems, and large software projects.
      `;

      fs.writeFileSync(sampleFilePath, sampleContent);
      console.log(`Created sample file at ${sampleFilePath}`);
    }
  });

  test("OpenSearch RAG workflow with history-aware retriever", async () => {
    // OpenSearch endpoint and credentials
    const endpoint =
      "https://search-sachin-opensearch-cvvd5pdeyrme2l2y26xmcpkm2a.us-east-1.es.amazonaws.com";
    const httpAuth = {
      username: "sachin-opensearch",
      password: "Sachin@123"
    };
    const indexName = "gpt-index-demo";

    // Initialize OpenSearch client
    const opensearchClient = new Client({
      node: endpoint,
      auth: httpAuth,
      ssl: {
        rejectUnauthorized: true
      }
    });

    // Load documents from a local directory
    const myPath = path.resolve(__dirname);
    const dataPath = path.join(myPath, "..", "data", "sample.txt");

    // Verify file exists before attempting to load
    if (!fs.existsSync(dataPath)) {
      throw new Error(
        `Sample file not found at ${dataPath}. Check beforeAll setup.`
      );
    }

    const loader = new TextLoader(dataPath);
    const documents = await loader.load();

    // Split documents into chunks
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 0
    });
    const docs = await textSplitter.splitDocuments(documents);

    // Create embeddings
    const embeddings = new OpenAIEmbeddings();

    // Use OpenSearchVectorStore
    const docsearch = await OpenSearchVectorStore.fromDocuments(
      docs,
      embeddings,
      {
        client: opensearchClient,
        indexName: indexName
      }
    );

    // Initialize the LLM
    const llm = new OpenAI({ temperature: 0 });

    // Convert to retriever
    const retriever = docsearch.asRetriever();

    // Get prompt from hub (simplified for TypeScript version)
    const promptTemplate = new PromptTemplate({
      template:
        "Answer the question based on the context.\nContext: {context}\nQuestion: {question}",
      inputVariables: ["context", "question"]
    });

    const formatDocs = (docs: any[]) => {
      return docs.map((doc) => doc.pageContent).join("\n\n");
    };

    const ragChain = RunnablePassthrough.assign({
      context: async (inputs: any) => {
        const docs = await retriever.getRelevantDocuments(inputs.question);
        return formatDocs(docs);
      }
    })
      .pipe(promptTemplate)
      .pipe(llm)
      .pipe(new StringOutputParser());
    console.log(ragChain);

    const qaSystemPrompt = `You are an assistant for question-answering tasks. 
Use the following pieces of retrieved context to answer the question. 
If you don't know the answer, just say that you don't know. 
Use three sentences maximum and keep the answer concise.

Context: {context}`;

    // Option 1: Use ChatPromptTemplate.fromTemplate with history
    const qaPromptWithHistory = ChatPromptTemplate.fromMessages([
      ["system", qaSystemPrompt],
      ["human", "{input}"],
      // Add a placeholder for chat history
      new MessagesPlaceholder("chat_history")
    ]);

    // Then use it like this:
    const combineDocsChain = await createStuffDocumentsChain({
      llm,
      prompt: qaPromptWithHistory
    });

    const chain = await createRetrievalChain({
      retriever,
      combineDocsChain
    });

    // Initialize empty chat history
    const chatHistory: any[] = [];

    // Execute query
    const question = "What is Task Decomposition?";
    const result = await chain.invoke({
      input: question,
      chat_history: chatHistory
    });
    console.log(result);

    // Verify spans
    const spans = customExporter.getCapturedSpans();

    for (const span of spans) {
      const spanAttributes = span.attributes;

      if (spanAttributes["span.type"] === "retrieval") {
        // Assertions for all retrieval attributes
        expect(spanAttributes["entity.1.name"]).toBe("OpenSearchVectorStore");
        expect(spanAttributes["entity.1.type"]).toBe(
          "vectorstore.OpenSearchVectorStore"
        );
        expect(spanAttributes).toHaveProperty("entity.1.deployment");
        expect(spanAttributes["entity.2.name"]).toBe("text-embedding-ada-002");
        expect(spanAttributes["entity.2.type"]).toBe(
          "model.embedding.text-embedding-ada-002"
        );
      }

      if (spanAttributes["span.type"] === "inference") {
        // Assertions for all inference attributes
        expect(spanAttributes["entity.1.type"]).toBe("inference.azure_oai");
        expect(spanAttributes).toHaveProperty("entity.1.provider_name");
        expect(spanAttributes).toHaveProperty("entity.1.inference_endpoint");
        expect(spanAttributes["entity.2.name"]).toBe("gpt-3.5-turbo-instruct");
        expect(spanAttributes["entity.2.type"]).toBe(
          "model.llm.gpt-3.5-turbo-instruct"
        );
      }
    }
  });
}, 30000);

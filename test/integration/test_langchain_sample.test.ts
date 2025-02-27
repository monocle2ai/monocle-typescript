import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import {
  RunnableSequence,
  RunnablePassthrough
} from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { Document } from "@langchain/core/documents";
import { describe, it, beforeAll, expect } from "vitest";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { CustomConsoleSpanExporter } from "../common/custom_exporter";
import { setupMonocle } from "../../dist";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { formatDocumentsAsString } from "langchain/util/document";

describe("LangChain Integration Tests", () => {
  let customExporter: CustomConsoleSpanExporter;

  beforeAll(() => {
    customExporter = new CustomConsoleSpanExporter();
    setupMonocle("langchain_app_1", [new BatchSpanProcessor(customExporter)]);
  });

  it("should run a RAG workflow with proper telemetry spans", async () => {
    // Initialize OpenAI model
    const llm = new ChatOpenAI({
      temperature: 0.1,
      modelName: "gpt-3.5-turbo-0125"
    });

    // Create sample documents instead of web loading
    const docs = [
      new Document({
        pageContent:
          "Task decomposition is a technique where complex tasks are broken down into simpler subtasks.",
        metadata: { source: "article" }
      }),
      new Document({
        pageContent:
          "Agents can use task decomposition to handle complex instructions by dividing them into manageable pieces.",
        metadata: { source: "article" }
      }),
      new Document({
        pageContent:
          "LLM agents benefit from task decomposition when facing multi-step problems.",
        metadata: { source: "article" }
      })
    ];

    // Create vector store with OpenAI embeddings
    const embeddings = new OpenAIEmbeddings();
    const vectorstore = await MemoryVectorStore.fromDocuments(docs, embeddings);

    // Create retriever
    const retriever = vectorstore.asRetriever();

    // Create RAG prompt
    const prompt = PromptTemplate.fromTemplate(`
      Answer the question based only on the following context:
      {context}

      Question: {question}
    `);

    // Create RAG chain
    const ragChain = RunnableSequence.from([
      {
        context: retriever.pipe(formatDocumentsAsString),
        question: new RunnablePassthrough()
      },
      prompt,
      llm,
      new StringOutputParser()
    ]);

    // Invoke the chain
    const result = await ragChain.invoke("What is Task Decomposition?");
    console.log(result);

    // Verify telemetry spans
    const spans = customExporter.getCapturedSpans();

    // Check spans
    for (const span of spans) {
      const spanAttributes = span.attributes;

      // Check retrieval spans
      if (spanAttributes && spanAttributes["span.type"] === "retrieval") {
        expect(spanAttributes["entity.1.name"]).toBe("MemoryVectorStore");
        expect(spanAttributes["entity.1.type"]).toBe(
          "vectorstore.MemoryVectorStore"
        );
        expect(spanAttributes["entity.2.name"]).toBe("text-embedding-ada-002");
        expect(spanAttributes["entity.2.type"]).toBe(
          "model.embedding.text-embedding-ada-002"
        );
      }

      // Check inference spans
      if (spanAttributes && spanAttributes["span.type"] === "inference") {
        expect(spanAttributes["entity.1.type"]).toBe("inference.openai");
        expect(spanAttributes).toHaveProperty("entity.1.provider_name");
        expect(spanAttributes["entity.2.name"]).toBe("gpt-3.5-turbo-0125");
        expect(spanAttributes["entity.2.type"]).toBe(
          "model.llm.gpt-3.5-turbo-0125"
        );
      }

      // Check root span
      if (!span.parent && span.name === "langchain.workflow") {
        expect(spanAttributes["entity.1.name"]).toBe("langchain_app_1");
        expect(spanAttributes["entity.1.type"]).toBe("workflow.langchain");
      }
    }
  });
}, 10000);

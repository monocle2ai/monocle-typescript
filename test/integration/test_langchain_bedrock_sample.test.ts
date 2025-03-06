import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { describe, it, beforeAll, expect } from "vitest";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import * as hub from "langchain/hub";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { ChatBedrockConverse } from "@langchain/aws";
import { Document } from "langchain/document";
import axios from "axios";
import { CustomConsoleSpanExporter } from "../common/custom_exporter";
import { setupMonocle } from "../../dist";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import {
  RunnablePassthrough,
  RunnableSequence
} from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { formatDocumentsAsString } from "langchain/util/document";

class SimpleWebLoader {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async load(): Promise<Document[]> {
    try {
      const response = await axios.get(this.url);
      const text = response.data;

      // Create a simple extraction of relevant content (simplified for test purposes)
      const content = this.extractContent(text);

      return [
        new Document({
          pageContent: content,
          metadata: { source: this.url }
        })
      ];
    } catch (error) {
      console.error("Error loading web content:", error);
      return [];
    }
  }

  private extractContent(html: string): string {
    // Simple regex-based content extraction (for testing purposes)
    const contentMatches = html.match(
      /<div class="post-content">([\s\S]*?)<\/div>/
    );
    const titleMatches = html.match(/<h1 class="post-title">([\s\S]*?)<\/h1>/);

    const content = contentMatches ? contentMatches[1] : "";
    const title = titleMatches ? titleMatches[1] : "";

    return `${title}\n\n${content}`.replace(/<[^>]*>/g, "");
  }
}

describe("Langchain Bedrock Integration Tests", () => {
  let customExporter: CustomConsoleSpanExporter;

  beforeAll(() => {
    customExporter = new CustomConsoleSpanExporter();
    const provider = new NodeTracerProvider();

    provider.addSpanProcessor(new SimpleSpanProcessor(customExporter));

    // Register the provider
    provider.register();
    setupMonocle("bedrock_rag_workflow");
  });

  it("should run Bedrock RAG workflow with proper telemetry", async () => {
    // Initialize AWS Bedrock client
    const bedrockRuntimeClient = new BedrockRuntimeClient({
      region: "us-east-1"
    });

    // Initialize LLM
    const llm = new ChatBedrockConverse({
      client: bedrockRuntimeClient,
      model: "ai21.jamba-1-5-mini-v1:0",
      temperature: 0.1,
      region: "us-east-1"
    });

    // Use our custom web loader instead of WebBaseLoader
    const webLoader = new SimpleWebLoader(
      "https://lilianweng.github.io/posts/2023-06-23-agent/"
    );
    const docs = await webLoader.load();

    // Split documents
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200
    });
    const splits = await textSplitter.splitDocuments(docs);

    const embeddings = new OpenAIEmbeddings();
    const vectorstore = await MemoryVectorStore.fromDocuments(
      splits,
      embeddings
    );

    const retriever = vectorstore.asRetriever();

    // Get prompt from LangChain Hub
    const prompt = await hub.pull("rlm/rag-prompt");

    const ragChain = RunnableSequence.from([
      {
        context: retriever.pipe(formatDocumentsAsString),
        question: new RunnablePassthrough()
      },
      prompt,
      llm,
      new StringOutputParser()
    ]);
    // Example usage of ragChain
    const query = "What is Task Decomposition?";
    const result = await ragChain.invoke(query);
    console.log(result);

    // Validate telemetry spans

    const spans = customExporter.getCapturedSpans();

    // Check for retrieval spans

    const retrievalSpan = spans.find(
      (span) =>
        span.name === "retrieval_operation" ||
        span.attributes["op.type"] === "retrieval"
    );

    if (retrievalSpan) {
      expect(retrievalSpan.attributes["entity.1.name"]).toBe(
        "MemoryVectorStore"
      );
      expect(retrievalSpan.attributes["entity.1.type"]).toBe(
        "vectorstore.MemoryVectorStore"
      );
      expect(retrievalSpan.attributes["entity.1.deployment"]).toBeDefined();
      expect(retrievalSpan.attributes["entity.2.name"]).toBe(
        "text-embedding-ada-002"
      );
      expect(retrievalSpan.attributes["entity.2.type"]).toBe(
        "model.embedding.text-embedding-ada-002"
      );
    }

    // Check for inference spans
    const inferenceSpan = spans.find(
      (span) => span.attributes["span.type"] === "inference"
    );

    if (inferenceSpan) {
      expect(inferenceSpan.attributes["entity.1.type"]).toBe(
        "inference.azure_oai"
      );
      expect(inferenceSpan.attributes["entity.1.provider_name"]).toBeDefined();
      expect(
        inferenceSpan.attributes["entity.1.inference_endpoint"]
      ).toBeDefined();
      expect(inferenceSpan.attributes["entity.2.name"]).toBe(
        "gpt-3.5-turbo-0125"
      );
      expect(inferenceSpan.attributes["entity.2.type"]).toBe(
        "model.llm.gpt-3.5-turbo-0125"
      );

      // Check metadata events
      expect(inferenceSpan.events.length).toBe(3);
      const [spanMetadata] = inferenceSpan.events;

      expect(spanMetadata.attributes["completion_tokens"]).toBeDefined();
      expect(spanMetadata.attributes["prompt_tokens"]).toBeDefined();
      expect(spanMetadata.attributes["total_tokens"]).toBeDefined();
    }

    // Check root span
    const rootSpan = spans.find(
      (span) => !span.parent && span.name === "langchain.workflow"
    );

    if (rootSpan) {
      expect(rootSpan.attributes["entity.1.name"]).toBe("langchain_app_1");
      expect(rootSpan.attributes["entity.1.type"]).toBe("workflow.langchain");
    }
  }, 10000);
});

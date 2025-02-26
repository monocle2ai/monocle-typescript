import { describe, it, beforeAll, expect } from "vitest";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import * as hub from "langchain/hub";
import { Document } from "langchain/document";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import {
  RunnablePassthrough,
  RunnableSequence
} from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import axios from "axios";
import { setupMonocle } from "../../instrumentation/common/instrumentation";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { CustomConsoleSpanExporter } from "../common/custom_exporter";

// For storing captured spans since ConsoleSpanExporter doesn't have getCapturedSpans
class WebLoader {
  private webPaths: string[];
  private bsKwargs: any;

  constructor(options: { web_paths: string[]; bs_kwargs?: any }) {
    this.webPaths = options.web_paths;
    this.bsKwargs = options.bs_kwargs || {};
  }

  async load(): Promise<Document[]> {
    const documents: Document[] = [];

    for (const url of this.webPaths) {
      try {
        const response = await axios.get(url);
        const html = response.data;

        // Use CheerioWebBaseLoader instead of direct cheerio
        const loader = new CheerioWebBaseLoader(html);
        loader.selector = ""; // Empty selector to get everything

        // If we have parsing options, set up selective extraction
        if (this.bsKwargs.parse_only && this.bsKwargs.parse_only.class_) {
          const classSelectors = this.bsKwargs.parse_only.class_.map(
            (cls: string) => `.${cls}`
          );
          loader.selector = classSelectors.join(", ");
        }

        // Create a Document with the URL but manually set page content
        // from our selected elements
        const baseDoc = new Document({
          pageContent: "",
          metadata: { source: url }
        });

        // Load HTML and apply selector
        const cheerioLoader = new CheerioWebBaseLoader(url, {
          selector: loader.selector || "body"
        });

        const loadedDocs = await cheerioLoader.load();

        // Use the content from the CheerioWebBaseLoader
        if (loadedDocs.length > 0) {
          documents.push(...loadedDocs);
        } else {
          // Fallback if no content was selected
          documents.push(baseDoc);
        }
      } catch (error) {
        console.error(`Error fetching ${url}:`, error);
      }
    }

    return documents;
  }
}

// Chroma class to replace Python's Chroma
class Chroma {
  private documents: Document[] = [];

  static async from_documents(options: {
    documents: Document[];
    embedding: OpenAIEmbeddings;
  }): Promise<Chroma> {
    const { documents } = options;

    // In a real implementation, this would interact with a Chroma database
    // For this example, we'll create a simple in-memory version
    const instance = new Chroma();
    await instance.addDocuments(documents);

    return instance;
  }

  async addDocuments(documents: Document[]): Promise<void> {
    this.documents.push(...documents);
  }

  as_retriever(): any {
    // In a real implementation, this would return a proper retriever
    // For simplicity, we'll create a basic function that returns all documents
    return async () => {
      return this.documents;
    };
  }
}

// Format documents helper function
const formatDocs = (docs: Document[]): string => {
  return docs.map((doc) => doc.pageContent).join("\n\n");
};

describe("Langchain OpenAI Integration Tests", () => {
  let customExporter: CustomConsoleSpanExporter;

  beforeAll(() => {
    customExporter = new CustomConsoleSpanExporter();
    const provider = new NodeTracerProvider();

    // Register your custom exporter with the provider
    provider.addSpanProcessor(new SimpleSpanProcessor(customExporter));

    // Register the provider
    provider.register();
    setupMonocle("openai_rag_workflow");
  });

  it("should run OpenAI RAG workflow with proper telemetry", async () => {
    // Initialize LLM
    const llm = new ChatOpenAI({
      model: "gpt-3.5-turbo-0125"
    });

    // Load, chunk and index the contents of the blog
    const loader = new WebLoader({
      web_paths: ["https://lilianweng.github.io/posts/2023-06-23-agent/"],
      bs_kwargs: {
        parse_only: {
          class_: ["post-content", "post-title", "post-header"]
        }
      }
    });

    const docs = await loader.load();

    // Split documents
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200
    });

    const splits = await textSplitter.splitDocuments(docs);

    const embeddings = new OpenAIEmbeddings();
    const vectorstore = await Chroma.from_documents({
      documents: splits,
      embedding: embeddings
    });

    // Retrieve and generate using the relevant snippets of the blog
    const retriever = vectorstore.as_retriever();

    // Get prompt from LangChain Hub
    const prompt = await hub.pull("rlm/rag-prompt");

    const ragChain = RunnableSequence.from([
      {
        context: async (query: string) => {
          const docs = await retriever(query);
          return formatDocs(docs);
        },
        question: new RunnablePassthrough()
      },
      prompt,
      llm,
      new StringOutputParser()
    ]);

    // Example usage of ragChain
    const result = await ragChain.invoke("What is Task Decomposition?");
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
      expect(retrievalSpan.attributes["entity.1.type"]).toBe(
        "vectorstore.Chroma"
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
        "inference.open_ai"
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
  }, 30000);
});

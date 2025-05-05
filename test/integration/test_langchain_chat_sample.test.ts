import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { formatDocumentsAsString } from "langchain/util/document";
import axios from "axios";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "langchain/document";
import { OpenAIEmbeddings } from "@langchain/openai";
import { AzureChatOpenAI } from "@langchain/openai";
import {
  ChatPromptTemplate,
  MessagesPlaceholder
} from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { HumanMessage } from "@langchain/core/messages";
import { CustomConsoleSpanExporter } from "../common/custom_exporter";
import { setupMonocle } from "../../dist";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { backupEnvVars, clearEnvVars, restoreEnvVars, OPENAI_ENV_VARS } from "../common/env_utils";

class WebBaseLoader {
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
        let content = response.data;

        if (this.bsKwargs.parse_only) {
          const classes = this.bsKwargs.parse_only.class_;
          for (const className of classes) {
            const regex = new RegExp(
              `<[^>]+class=["']${className}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
              "g"
            );
            const matches = [...content.matchAll(regex)];
            content = matches.map((match) => match[1]).join("\n");
          }
        }

        documents.push(
          new Document({
            pageContent: content,
            metadata: { source: url }
          })
        );
      } catch (error) {
        console.error(`Error fetching ${url}:`, error);
      }
    }

    return documents;
  }
}

function createHistoryAwareRetriever(llm: any, retriever: any, prompt: any) {
  const historyAwareRetrieval = async (input: {
    input: string;
    chat_history: any[];
  }) => {
    const { input: question, chat_history } = input;

    // Generate a standalone question
    const standaloneQuestion = await prompt
      .pipe(llm)
      .pipe(new StringOutputParser())
      .invoke({
        input: question,
        chat_history
      });

    // Use the standalone question for retrieval
    return retriever.invoke(standaloneQuestion);
  };

  return {
    invoke: historyAwareRetrieval
  };
}

describe("Langchain Integration Tests", () => {
  let customExporter: CustomConsoleSpanExporter;
  let openaiEnvBackup: Record<string, string | undefined>;

  beforeAll(() => {
    customExporter = new CustomConsoleSpanExporter();

    // Setup the provider with our custom exporter
    const provider = new NodeTracerProvider({
      spanProcessors: [
        new BatchSpanProcessor(customExporter)
      ]
    });
    provider.register();

    // Backup OpenAI environment variables
    openaiEnvBackup = backupEnvVars(OPENAI_ENV_VARS);

    // Clear OpenAI environment variables if Azure OpenAI API key is present
    // clearEnvVars(OPENAI_ENV_VARS, !!process.env.AZURE_OPENAI_API_KEY);

    // Setup Monocle telemetry with custom exporter
    setupMonocle("langchain_app_1");
  });

  afterAll(() => {
    // Restore OpenAI environment variables
    restoreEnvVars(openaiEnvBackup);
  });

  it("should run LangChain chat workflow with proper telemetry", async () => {
    const llm = new AzureChatOpenAI({
      azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT,
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      temperature: 0.7,
      model: "gpt-3.5-turbo-0125"
    });
    // Load, chunk and index the contents of the blog
    const loader = new WebBaseLoader({
      web_paths: ["https://lilianweng.github.io/posts/2023-06-23-agent/"],
      bs_kwargs: {
        parse_only: {
          class_: ["post-content", "post-title", "post-header"]
        }
      }
    });

    const docs = await loader.load();

    // Split text into chunks
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200
    });
    const splits = await textSplitter.splitDocuments(docs);

    // Create vector store
    const embeddings = new OpenAIEmbeddings({apiKey: process.env.OPENAI_API_KEY});
    const vectorstore = await MemoryVectorStore.fromDocuments(
      splits,
      embeddings
    );

    // Create retriever
    const retriever = vectorstore.asRetriever();

    // Setup for history-aware retriever
    const contextualizeQSystemPrompt = `Given a chat history and the latest user question \
    which might reference context in the chat history, formulate a standalone question \
    which can be understood without the chat history. Do NOT answer the question, \
    just reformulate it if needed and otherwise return it as is.`;

    const contextualizeQPrompt = ChatPromptTemplate.fromMessages([
      ["system", contextualizeQSystemPrompt],
      new MessagesPlaceholder("chat_history"),
      ["user", "{input}"]
    ]);

    const historyAwareRetriever = createHistoryAwareRetriever(
      llm,
      retriever,
      contextualizeQPrompt
    );

    const qaSystemPrompt = `You are an assistant for question-answering tasks. \
           Use the following pieces of retrieved context to answer the question. \
           If you don't know the answer, just say that you don't know. \
           Use three sentences maximum and keep the answer concise.\{context}`;

    const qaPrompt = ChatPromptTemplate.fromMessages([
      ["system", qaSystemPrompt],
      new MessagesPlaceholder("chat_history"),
      ["user", "{input}"]
    ]);

    // Create question-answering chain
    const questionAnswerChain = async (input: any) => {
      const { input: question, chat_history, context } = input;

      // Format prompt with context and question
      const formattedPrompt = await qaPrompt.formatMessages({
        context: formatDocumentsAsString(context),
        input: question,
        chat_history
      });

      // Get response from LLM
      const response = await llm.invoke(formattedPrompt);

      return { answer: response };
    };

    // Create retrieval chain
    const ragChain = async (input: any) => {
      const { input: question, chat_history } = input;

      // Get relevant documents
      const context = await historyAwareRetriever.invoke({
        input: question,
        chat_history
      });

      // Get answer
      return questionAnswerChain({
        input: question,
        chat_history,
        context
      });
    };

    // Run the chain with first question
    let chatHistory: any[] = [];
    const question = "What is Task Decomposition?";
    const aiMsg1 = await ragChain({
      input: question,
      chat_history: chatHistory
    });

    // Update chat history
    chatHistory.push(new HumanMessage(question));
    chatHistory.push(aiMsg1.answer);

    // Run with follow-up question
    const secondQuestion = "What are common ways of doing it?";
    const aiMsg2 = await ragChain({
      input: secondQuestion,
      chat_history: chatHistory
    });


    // Get captured spans for assertions
    const spans = customExporter.getCapturedSpans();

    // Test assertions for retrieval spans
    const retrievalSpan = spans.find(
      (span) => span.attributes["span.type"] === "retrieval"
    );

    if (retrievalSpan) {
      expect(retrievalSpan.attributes["entity.1.name"]).toBe("Chroma");
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

    // Test assertions for inference spans
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

      // Check metadata events - assuming events are in the same order as Python
      const spanMetadata = inferenceSpan.events[2]; // Metadata should be the third event
      expect(inferenceSpan.events.length).toBeGreaterThanOrEqual(3);
      expect(spanMetadata.attributes["completion_tokens"]).toBeDefined();
      expect(spanMetadata.attributes["prompt_tokens"]).toBeDefined();
      expect(spanMetadata.attributes["total_tokens"]).toBeDefined();
    }

    // Test assertions for root span
    const rootSpan = spans.find(
      (span) => !span.parent && span.name === "langchain.workflow"
    );

    if (rootSpan) {
      expect(rootSpan.attributes["entity.1.name"]).toBe("langchain_app_1");
      expect(rootSpan.attributes["entity.1.type"]).toBe("workflow");
    }
  });
}, 30000);

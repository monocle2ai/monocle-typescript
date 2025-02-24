import { setupMonocle } from "../../instrumentation/common/instrumentation";
import { OpenAIEmbeddings, AzureChatOpenAI } from "@langchain/openai";
import { WebBaseLoader } from "@langchain/community/document_loaders/web";
import {
  ChatPromptTemplate,
  MessagesPlaceholder
} from "@langchain/core/prompts";
import { HumanMessage } from "@langchain/core/messages";
import { RecursiveCharacterTextSplitter } from "@langchain/text_splitters";
const { MemoryVectorStore } = require("langchain/vectorstores/memory");

import {
  createRetrievalChain,
  createStuffDocumentsChain
} from "@langchain/chains";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import {
  BatchSpanProcessor,
  ReadableSpan
} from "@opentelemetry/sdk-trace-base";
import { ExportResult } from "@opentelemetry/core";

// Import custom function to create history aware retriever
import { createHistoryAwareRetriever } from "../../common/langhchain_patch";

// Custom exporter that captures spans for testing
class CustomConsoleSpanExporter extends ConsoleSpanExporter {
  private capturedSpans: any[] = [];

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void
  ): void {
    this.capturedSpans.push(...spans);
    super.export(spans, resultCallback);
  }

  getCapturedSpans() {
    return this.capturedSpans;
  }
}

describe("LangChain Chat Integration Tests", () => {
  let customExporter: CustomConsoleSpanExporter;

  beforeAll(() => {
    customExporter = new CustomConsoleSpanExporter();
    setupMonocle("langchain_app_1", [new BatchSpanProcessor(customExporter)]);
  });

  it("should run a chat-based RAG workflow with proper telemetry spans", async () => {
    // Initialize Azure OpenAI model
    const llm = new AzureChatOpenAI({
      azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT,
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      temperature: 0.7,
      modelName: "gpt-3.5-turbo-0125"
    });

    // Load, chunk and index the contents of the blog
    const loader = new WebBaseLoader(
      "https://lilianweng.github.io/posts/2023-06-23-agent/"
    );

    const docs = await loader.load();
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

    // Create retriever
    const retriever = vectorstore.asRetriever();

    // Create contextualize question prompt
    const contextualizeQSystemPrompt = `Given a chat history and the latest user question \
which might reference context in the chat history, formulate a standalone question \
which can be understood without the chat history. Do NOT answer the question, \
just reformulate it if needed and otherwise return it as is.`;

    const contextualizeQPrompt = ChatPromptTemplate.fromMessages([
      ["system", contextualizeQSystemPrompt],
      new MessagesPlaceholder("chat_history"),
      ["user", "{input}"]
    ]);

    // Create history-aware retriever
    const historyAwareRetriever = createHistoryAwareRetriever(
      llm,
      retriever,
      contextualizeQPrompt
    );

    // Create QA prompt
    const qaSystemPrompt = `You are an assistant for question-answering tasks. \
Use the following pieces of retrieved context to answer the question. \
If you don't know the answer, just say that you don't know. \
Use three sentences maximum and keep the answer concise.\

{context}`;

    const qaPrompt = ChatPromptTemplate.fromMessages([
      ["system", qaSystemPrompt],
      new MessagesPlaceholder("chat_history"),
      ["user", "{input}"]
    ]);

    // Create QA chain and retrieval chain
    const questionAnswerChain = createStuffDocumentsChain({
      llm,
      prompt: qaPrompt
    });

    const ragChain = createRetrievalChain({
      retriever: historyAwareRetriever,
      combineDocsChain: questionAnswerChain
    });

    // Set up chat history and context properties
    const chatHistory: any[] = [];
    try {
      // Try using setupMonocle to set properties if available
      setupMonocle("langchain_app_1", [new BatchSpanProcessor(customExporter)]);
    } catch (e) {
      console.log("Unable to set context properties, continuing test...");
    }
    // First question
    const question = "What is Task Decomposition?";
    const aiMsg1 = await ragChain.invoke({
      input: question,
      chat_history: chatHistory
    });

    chatHistory.push(new HumanMessage(question));
    chatHistory.push(aiMsg1.answer);

    // Second question
    const secondQuestion = "What are common ways of doing it?";
    const aiMsg2 = await ragChain.invoke({
      input: secondQuestion,
      chat_history: chatHistory
    });

    console.log(aiMsg2.answer);

    // Verify telemetry spans
    const spans = customExporter.getCapturedSpans();

    // Check spans
    for (const span of spans) {
      const spanAttributes = span.attributes;

      // Check retrieval spans
      if (spanAttributes && spanAttributes["span.type"] === "retrieval") {
        expect(spanAttributes["entity.1.name"]).toBe("Chroma");
        expect(spanAttributes["entity.1.type"]).toBe("vectorstore.Chroma");
        expect(spanAttributes).toHaveProperty("entity.1.deployment");
        expect(spanAttributes["entity.2.name"]).toBe("text-embedding-ada-002");
        expect(spanAttributes["entity.2.type"]).toBe(
          "model.embedding.text-embedding-ada-002"
        );
      }

      // Check inference spans
      if (spanAttributes && spanAttributes["span.type"] === "inference") {
        expect(spanAttributes["entity.1.type"]).toBe("inference.azure_oai");
        expect(spanAttributes).toHaveProperty("entity.1.provider_name");
        expect(spanAttributes).toHaveProperty("entity.1.inference_endpoint");
        expect(spanAttributes["entity.2.name"]).toBe("gpt-3.5-turbo-0125");
        expect(spanAttributes["entity.2.type"]).toBe(
          "model.llm.gpt-3.5-turbo-0125"
        );

        // Check metadata events
        if (span.events && span.events.length >= 3) {
          const [spanMetadata] = span.events;
          expect(spanMetadata.attributes).toHaveProperty("completion_tokens");
          expect(spanMetadata.attributes).toHaveProperty("prompt_tokens");
          expect(spanMetadata.attributes).toHaveProperty("total_tokens");
        }
      }

      // Check root span
      if (!span.parent && span.name === "langchain.workflow") {
        expect(spanAttributes["entity.1.name"]).toBe("langchain_app_1");
        expect(spanAttributes["entity.1.type"]).toBe("workflow.langchain");
      }
    }
  });
});

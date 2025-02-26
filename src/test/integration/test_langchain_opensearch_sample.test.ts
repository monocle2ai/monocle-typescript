import path from "path";
import {
  ConsoleSpanExporter,
  ReadableSpan
} from "@opentelemetry/sdk-trace-node";

import { OpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";

import { PromptTemplate } from "@langchain/core/prompts";
const { StringOutputParser } = require("@langchain/core/output_parsers");
import { TextLoader } from "langchain/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenSearchVectorStore } from "@langchain/community/vectorstores/opensearch";
const { RunnablePassthrough } = require("@langchain/core/runnables");
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder
} from "@langchain/core/prompts";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { Client } from "@opensearch-project/opensearch";
import { setupMonocle } from "../../instrumentation/common/instrumentation";
import { ExportResult } from "@opentelemetry/core";

interface CapturedSpan {
  name: string;
  attributes: Record<string, any>;
  events: any[];
  parent?: CapturedSpan;
}

class CustomConsoleSpanExporter extends ConsoleSpanExporter {
  private capturedSpans: CapturedSpan[] = [];

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void
  ): void {
    // Store spans for later assertions
    this.capturedSpans.push(...spans);
    // Call the parent method with both required arguments
    super.export(spans, resultCallback);
  }

  getCapturedSpans(): CapturedSpan[] {
    return this.capturedSpans;
  }
}

describe("LangChain OpenSearch Integration", () => {
  let customExporter: CustomConsoleSpanExporter;
  beforeAll(() => {
    customExporter = new CustomConsoleSpanExporter();
    setupMonocle("langchain_opensearch");
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
    // Create history-aware retriever
    // const contextualizeQSystemPrompt = `Given a chat history and the latest user question \
    //   which might reference context in the chat history, formulate a standalone question \
    //   which can be understood without the chat history. Do NOT answer the question, \
    //   just reformulate it if needed and otherwise return it as is.`;

    // const contextualizeQPrompt = ChatPromptTemplate.fromMessages([
    //   new SystemMessage(contextualizeQSystemPrompt),
    //   new MessagesPlaceholder("chat_history"),
    //   new HumanMessage("{input}")
    // ]);

    // const historyAwareRetriever = createHistoryAwareRetriever(
    //   llm,
    //   retriever,
    //   contextualizeQPrompt
    // );

    const qaSystemPrompt = `You are an assistant for question-answering tasks. \
      Use the following pieces of retrieved context to answer the question. \
      If you don't know the answer, just say that you don't know. \
      Use three sentences maximum and keep the answer concise.\n\n{context}`;

    const qaPrompt = ChatPromptTemplate.fromMessages([
      new SystemMessage(qaSystemPrompt),
      new MessagesPlaceholder("chat_history"),
      new HumanMessage("{input}")
    ]);

    const combineDocsChain = await createStuffDocumentsChain({
      llm,
      prompt: qaPrompt
    });

    const chain = await createRetrievalChain({
      retriever,
      combineDocsChain
    });

    // const questionAnswerChain = createStuffDocumentsChain({
    //   llm,
    //   prompt: qaPrompt
    // });

    // const ragChainWithHistory = createRetrievalChain({
    //   retriever: historyAwareRetriever,
    //   combineDocsChain: questionAnswerChain
    // });
    // const questionAnswerChain = await createStuffDocumentsChain({
    //   llm,
    //   prompt: qaPrompt
    // });
    // const combineDocsChain = await createStuffDocumentsChain({
    //   llm: model,
    //   prompt: questionAnsweringPrompt
    // });

    // const chain = await createRetrievalChain({
    //   retriever: VectorStore.asRetriever(),
    //   combineDocsChain
    // });

    // // Fix 2: Await the promise from createRetrievalChain
    // const ragChainWithHistory = await createRetrievalChain({
    //   retriever: historyAwareRetriever,
    //   combineDocsChain: questionAnswerChain
    // });
    // const retrievalChain = await createRetrievalChain({
    //   retriever,
    //   combineDocsChain
    // });

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

      // Check root span
      //   if (!span.parentSpanId && span.name.includes("langchain")) {
      //     expect(spanAttributes["entity.1.name"]).toBe("langchain_opensearch");
      //     expect(spanAttributes["entity.1.type"]).toBe("workflow.langchain");
      //   }
    }
  });
});

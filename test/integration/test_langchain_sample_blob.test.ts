import { describe, it, beforeAll, expect } from "vitest";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import {
  RunnablePassthrough,
  RunnableSequence
} from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate
} from "@langchain/core/prompts";
import { createRetrievalChain } from "langchain/chains/retrieval";
import axios from "axios";
import { Document } from "langchain/document";
import { CustomConsoleSpanExporter } from "../common/custom_exporter";
import { setupMonocle } from "../../dist";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";

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
    // In production, consider a proper HTML parser
    const contentMatches = html.match(
      /<div class="post-content">([\s\S]*?)<\/div>/
    );
    const titleMatches = html.match(/<h1 class="post-title">([\s\S]*?)<\/h1>/);

    const content = contentMatches ? contentMatches[1] : "";
    const title = titleMatches ? titleMatches[1] : "";

    return `${title}\n\n${content}`.replace(/<[^>]*>/g, "");
  }
}

describe("Langchain RAG Integration Tests", () => {
  let customExporter: CustomConsoleSpanExporter;

  beforeAll(() => {
    customExporter = new CustomConsoleSpanExporter();
    setupMonocle("langchain_app_1", [new BatchSpanProcessor(customExporter)]);
  });

  it("should run RAG workflow with proper telemetry", async () => {
    const llm = new ChatOpenAI({ modelName: "gpt-3.5-turbo-0125" });

    // Load, chunk and index the contents of the blog
    const loader = new SimpleWebLoader(
      "https://lilianweng.github.io/posts/2023-06-23-agent/"
    );
    const docs = await loader.load();

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200
    });
    const splits = await textSplitter.splitDocuments(docs);
    const vectorstore = await MemoryVectorStore.fromDocuments(
      splits,
      new OpenAIEmbeddings()
    );

    // Retrieve and generate using the relevant snippets of the blog
    const retriever = vectorstore.asRetriever();
    const qaPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        "You are an assistant for question-answering tasks. \
    Use the following pieces of retrieved context to answer the question. \
    If you don't know the answer, just say that you don't know. \
    Use three sentences maximum and keep the answer concise.\n\n{context}"
      ),
      new MessagesPlaceholder("chat_history"),
      HumanMessagePromptTemplate.fromTemplate("{input}")
    ]);
    const combineDocsChain = await createStuffDocumentsChain({
      llm,
      prompt: qaPrompt
    });

    const chain = await createRetrievalChain({
      retriever,
      combineDocsChain
    });

    const chatHistory: any[] = [];

    const question = "What is Task Decomposition?";
    const aiMsg1 = await chain.invoke({
      input: question,
      chat_history: chatHistory
    });


    // Validate telemetry spans
    const spans = customExporter.getCapturedSpans();

    for (const span of spans) {
      const spanAttributes = span.attributes;

      if (spanAttributes["span.type"] === "retrieval") {
        // Assertions for all retrieval attributes
        expect(spanAttributes["entity.1.name"]).toBe("MemoryVectorStore");
        expect(spanAttributes["entity.1.type"]).toBe(
          "vectorstore.MemoryVectorStore"
        );
        expect(spanAttributes["entity.1.deployment"]).toBeDefined();
        expect(spanAttributes["entity.2.name"]).toBe("text-embedding-ada-002");
        expect(spanAttributes["entity.2.type"]).toBe(
          "model.embedding.text-embedding-ada-002"
        );
      }

      if (spanAttributes["span.type"] === "inference") {
        expect(spanAttributes["entity.1.type"]).toBe("inference.azure_oai");
        expect(spanAttributes["entity.1.provider_name"]).toBeDefined();
        expect(spanAttributes["entity.1.inference_endpoint"]).toBeDefined();
        expect(spanAttributes["entity.2.name"]).toBe("gpt-3.5-turbo-0125");
        expect(spanAttributes["entity.2.type"]).toBe(
          "model.llm.gpt-3.5-turbo-0125"
        );

        // Assertions for metadata
        if (span.events.length >= 3) {
          const [spanMetadata] = span.events;
          expect(spanMetadata.attributes["completion_tokens"]).toBeDefined();
          expect(spanMetadata.attributes["prompt_tokens"]).toBeDefined();
          expect(spanMetadata.attributes["total_tokens"]).toBeDefined();
        }
      }

      // Check root span
      if (!span.parent && span.name === "langchain.workflow") {
        expect(spanAttributes["entity.1.name"]).toBe("langchain_app_1");
        expect(spanAttributes["entity.1.type"]).toBe("workflow");
      }
    }
  }, 30000);

  it("should run Least-to-Most RAG workflow with proper telemetry", async () => {
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

    // Create the decomposition prompt
    const decompositionPrompt = ChatPromptTemplate.fromTemplate(`
      You are a helpful assistant that can break down complex questions into simpler parts. \n
      Your goal is to decompose the given question into multiple sub-questions that can be answerd in isolation to answer the main question in the end. \n
      Provide these sub-questions separated by the newline character. \n
      Original question: {question}\n
      Output (3 queries):
    `);
    const queryGenerationChain = RunnableSequence.from([
      {
        question: new RunnablePassthrough()
      },
      decompositionPrompt,
      new ChatOpenAI({ modelName: "gpt-3.5-turbo-0125", temperature: 0.7 }),
      new StringOutputParser(),
      (output: string) => output.split("\n")
    ]);

    const query = "What is Task Decomposition?";
    const llm = new ChatOpenAI({
      modelName: "gpt-3.5-turbo-0125",
      temperature: 0
    });
    const questions = await queryGenerationChain.invoke({
      question: query
    });

    // Create the final prompt template
    const template = `Here is the question you need to answer:

    \n --- \n {question} \n --- \n

    Here is any available background question + answer pairs:

    \n --- \n {q_a_pairs} \n --- \n

    Here is additional context relevant to the question:

    \n --- \n {context} \n --- \n

    Use the above context and any background question + answer pairs to answer the question: \n {question}
    `;

    const leastToMostPrompt = ChatPromptTemplate.fromTemplate(template);

    // Process each sub-question
    const processQuestion = async (question: string, qaHistory: string) => {
      // Retrieve context for the question
      const context = await retriever.invoke(question);

      // Run the prompt with all inputs
      const promptResult = await leastToMostPrompt.invoke({
        context,
        q_a_pairs: qaHistory,
        question
      });

      // Run the LLM with the prompt result
      const llmResult = await llm.invoke(promptResult);

      // Parse the output
      return new StringOutputParser().invoke(llmResult);
    };

    let q_a_pairs = "";
    for (const q of questions) {
      const answer = await processQuestion(q, q_a_pairs);
      q_a_pairs += `Question: ${q}\n\nAnswer: ${answer}\n\n`;
    }

    // Final RAG step
    const response = await processQuestion(query, q_a_pairs);

    // Validate telemetry spans
    const spans = customExporter.getCapturedSpans();

    // Check for retrieval spans
    for (const span of spans) {
      const spanAttributes = span.attributes;

      if (spanAttributes["span.type"] === "retrieval") {
        // Assertions for all retrieval attributes
        expect(spanAttributes["entity.1.name"]).toBe("MemoryVector");
        expect(spanAttributes["entity.1.type"]).toBe(
          "vectorstore.MemoryVector"
        );
        expect(spanAttributes["entity.1.deployment"]).toBeDefined();
        expect(spanAttributes["entity.2.name"]).toBe("text-embedding-ada-002");
        expect(spanAttributes["entity.2.type"]).toBe(
          "model.embedding.text-embedding-ada-002"
        );
      }

      if (spanAttributes["span.type"] === "inference") {
        // Assertions for all inference attributes
        expect(spanAttributes["entity.1.type"]).toBe("inference.azure_oai");
        expect(spanAttributes["entity.1.provider_name"]).toBeDefined();
        expect(spanAttributes["entity.1.inference_endpoint"]).toBeDefined();
        expect(spanAttributes["entity.2.name"]).toBe("gpt-3.5-turbo-0125");
        expect(spanAttributes["entity.2.type"]).toBe(
          "model.llm.gpt-3.5-turbo-0125"
        );

        // Assertions for metadata
        if (span.events.length >= 3) {
          const [spanMetadata] = span.events;
          expect(spanMetadata.attributes["completion_tokens"]).toBeDefined();
          expect(spanMetadata.attributes["prompt_tokens"]).toBeDefined();
          expect(spanMetadata.attributes["total_tokens"]).toBeDefined();
        }
      }

      // Check root span
      if (!span.parent && span.name === "langchain.workflow") {
        expect(spanAttributes["entity.1.name"]).toBe("langchain_app_1");
        expect(spanAttributes["entity.1.type"]).toBe("workflow");
      }
    }
  }, 30000); // Extended timeout for the Least-to-Most test
});

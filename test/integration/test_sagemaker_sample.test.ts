import {
  BaseSageMakerContentHandler,
  SageMakerEndpoint
} from "@langchain/community/llms/sagemaker_endpoint";
import { OpenSearchVectorStore } from "@langchain/community/vectorstores/opensearch";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter
} from "@opentelemetry/sdk-trace-base";
import { describe, it, beforeAll } from "vitest";
import * as AWS from "aws-sdk";
import { Client } from "@opensearch-project/opensearch";
import AWS4Auth from "aws4";
import { Document } from "langchain/document";
import { setupMonocle } from "../../dist";
import { EmbeddingsInterface } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import { promises as fs } from "fs";
import { join } from "path";

interface LLMResponseData {
  context: string;
  question: string;
}

interface LLMResponseResult {
  answer: string;
}

class SageMakerEmbeddings implements EmbeddingsInterface {
  private client: SageMakerEndpoint;

  constructor(client: SageMakerEndpoint) {
    this.client = client;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const embeddings = [] as number[][];
    for (const doc of documents) {
      const embedding = await this.embedQuery(doc);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    const response = await this.client.invoke(text);
    return JSON.parse(response);
  }
}

// class ContentHandler extends BaseSageMakerContentHandler<string, string> {
//   contentType = "application/json";
//   accepts = "application/json";

//   // Implement transformInput as required by BaseSageMakerContentHandler
//   transformInput(inputs: string[], model_kwargs: Record<string, any>): string {
//     return JSON.stringify({ text_inputs: inputs, ...model_kwargs });
//   }

//   // Implement transformOutput as required by BaseSageMakerContentHandler
//   transformOutput(output: string): string {
//     const response_json = JSON.parse(output);
//     return response_json["embedding"];
//   }
// }
describe("Sagemaker Integration Tests", () => {
  beforeAll(() => {
    setupMonocle(
      "sagemaker_workflow_1",
      [new BatchSpanProcessor(new ConsoleSpanExporter())],
      []
    );
  });

  it("should test sagemaker sample", async () => {
    // Equivalent to the Python test function
    await produce_llm_response("hello");
  });
});

async function produce_llm_response(query: string): Promise<string> {
  const client = new AWS.SageMakerRuntime({ region: "us-east-1" });

  const endpointName = "okahu-sagemaker-rag-qa-ep";
  const contentType = "application/json";
  const accept = "application/json";

  const data: LLMResponseData = {
    context: `You are an assistant for question-answering tasks. \
Use the following pieces of retrieved context to answer the question. \
If you don't know the answer, just say that you don't know. \
Use three sentences maximum and keep the answer concise.\
`,
    question: query
  };

  const params = {
    EndpointName: endpointName,
    ContentType: contentType,
    Accept: accept,
    Body: JSON.stringify(data)
  };

  try {
    const response = await client.invokeEndpoint(params).promise();

    const context = await search_similar_documents_opensearch(query);

    // TypeScript specific handling of the response
    const content = response.Body as AWS.SageMakerRuntime.BodyBlob;

    // Convert buffer to string
    const responseStr = content.toString("utf-8");

    const parsedResponse = JSON.parse(responseStr) as LLMResponseResult;
    return parsedResponse.answer;
  } catch (error) {
    console.error("Error invoking SageMaker endpoint:", error);
    throw error;
  }
}

function build_context(similar_documents: string[]): string {
  if (similar_documents.length > 0) {
    const documents_concatenated = similar_documents.join(
      "-------------END OF DOCUMENT-------------"
    );
    return `Based on embedding lookup, we've found these documents to be the most relevant from the knowledge
    base: ${documents_concatenated}`;
  } else {
    return (
      "We couldn't locate any documents that would be relevant for this question. Please apologize politely " +
      "and say that you don't know the answer if this is not something you can answer on your own."
    );
  }
}

async function search_similar_documents_opensearch(
  query: string
): Promise<string[]> {
  const index_name = "embeddings";
  // const content_handler = new ContentHandler();
  const sagemaker_endpoint_embeddings = new OpenAIEmbeddings({apiKey: process.env["OPENAI_API_KEY"] as string});

  const region = "us-east-1";
  const service = "aoss";
  const credentials = new AWS.Credentials({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    // sessionToken: process.env.AWS_SESSION_TOKEN
  });
  const endpoint = process.env.OPENSEARCH_ENDPOINT;

  const opensearchClient = new Client({
    node: endpoint,
    ssl: {
      rejectUnauthorized: true
    },
    
    auth: {
      credentials : {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
      region: region,
      service: service,
    }
  });

  const doc_search = new OpenSearchVectorStore(
    sagemaker_endpoint_embeddings,
    {
      client: opensearchClient,
      indexName: index_name
    });

  try {
    // // check if index exists
    // const indexExists = await doc_search.doesIndexExist();
    // if (!indexExists) {
    //   const ndjsonPath = join(__dirname, '../data/sample.txt');
    //   const sampleText = await fs.readFile(ndjsonPath, 'utf-8')
    //   await doc_search.addDocuments([{
    //     pageContent: sampleText,
    //     metadata: { creator: "test_sagemaker_sample.test.ts" },
    //     id: "sample"
    //   }]);
    // }
    const docs = await doc_search.similaritySearch(query);
    return docs.map((doc: Document) => doc.pageContent);
  } catch (error) {
    console.error("Error during similarity search:", error);
    return [];
  }
}

export {
  produce_llm_response,
  build_context,
  search_similar_documents_opensearch
};

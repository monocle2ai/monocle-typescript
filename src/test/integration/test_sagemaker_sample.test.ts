import {
  BaseSageMakerContentHandler,
  SageMakerEndpoint,
  SageMakerLLMContentHandler
} from "@langchain/community/llms/sagemaker_endpoint";
import { OpenSearchVectorStore } from "@langchain/community/vectorstores/opensearch";

import {
  BatchSpanProcessor,
  ConsoleSpanExporter
} from "@opentelemetry/sdk-trace-base";
import { describe, it, beforeAll } from "@jest/globals";
import * as AWS from "aws-sdk";
import { Client } from "@opensearch-project/opensearch";
import AWS4Auth from "aws4"; // TypeScript alternative to requests_aws4auth
import { Document } from "langchain/document";
import { setupMonocle } from "../../instrumentation/common/instrumentation";

interface LLMResponseData {
  context: string;
  question: string;
}

interface LLMResponseResult {
  answer: string;
}

class ContentHandler extends BaseSageMakerContentHandler<string, string> {
  contentType = "application/json";
  accepts = "application/json";

  // Implement transformInput as required by BaseSageMakerContentHandler
  transformInput(inputs: string[], model_kwargs: Record<string, any>): string {
    return JSON.stringify({ text_inputs: inputs, ...model_kwargs });
  }

  // Implement transformOutput as required by BaseSageMakerContentHandler
  transformOutput(output: string): string {
    const response_json = JSON.parse(output);
    return response_json["embedding"];
  }
}
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

    // TypeScript specific handling of the response
    const content = response.Body as AWS.SageMakerRuntime.BodyBlob;

    // Convert buffer to string
    const responseStr = content.toString("utf-8");
    console.log(`The response provided by the endpoint: ${responseStr}`);

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
  const opensearch_url = process.env.OPENSEARCH_ENDPOINT_URL || "";
  const index_name = "embeddings"; // Your index name

  const content_handler = new ContentHandler();

  //   const sagemaker_endpoint_embeddings = new SageMakerEndpoint({
  //     endpointName: "okahu-sagemaker-rag-embedding-ep",
  //     region: "us-east-1",
  //     content_handler
  //   });
  const sagemaker_endpoint_embeddings = new SageMakerEndpoint({
    endpointName: "okahu-sagemaker-rag-embedding-ep",
    content_handler
  });

  const region = "us-east-1";
  const service = "aoss";

  // Get AWS credentials
  const credentials = new AWS.Credentials({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    sessionToken: process.env.AWS_SESSION_TOKEN
  });

  // Create AWS4Auth - note: this implementation may need adjustment based on your AWS4Auth library
  const aws_auth = AWS4Auth({
    accessKey: credentials.accessKeyId,
    secretKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    region: region,
    service: service
  });

  const doc_search = new OpenSearchVectorStore({
    client: {
      node: opensearch_url,
      auth: aws_auth,
      ssl: {
        rejectUnauthorized: true
      },
      // You may need to adapt these options to match your TypeScript OpenSearch client
      Connection: Client
    },
    indexName: index_name,
    embeddingFunction: sagemaker_endpoint_embeddings
  });

  try {
    const docs = await doc_search.similaritySearch(query);
    console.log(`Retrieved docs: ${JSON.stringify(docs)}`);
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

import { describe, it, beforeAll, expect } from "vitest";
import * as path from "path";
import {
  VectorStoreIndex,
  SimpleDirectoryReader,
  storageContextFromDefaults
} from "llamaindex";
import { OpenSearchVectorStore } from "@llamaindex/opensearch";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter
} from "@opentelemetry/sdk-trace-node";

const { setupMonocle } = require("../instrumentation/common/instrumentation");

describe("LlamaIndex OpenSearch Integration", () => {
  beforeAll(() => {
    setupMonocle({
      workflowName: "llama_index_1",
      spanProcessors: [new BatchSpanProcessor(new ConsoleSpanExporter())],
      wrapperMethods: []
    });
  });

  it(
    "should query OpenSearch vector store correctly",
    async () => {
      // http endpoint for your cluster (opensearch required for vector index usage)
      const endpoint =
        "https://search-sachin-opensearch-cvvd5pdeyrme2l2y26xmcpkm2a.us-east-1.es.amazonaws.com";
      // index to demonstrate the VectorStore impl
      const idx = "gpt-index-demo";

      // load some sample data
      const myPath = path.resolve(__dirname);
      const modelPath = path.join(myPath, "../../data");
      const documents = await new SimpleDirectoryReader().loadData({
        directoryPath: modelPath
      });

      // OpenSearchVectorStore configuration
      const textField = "content";
      const embeddingField = "embedding";
      const dimensions = 1536;

      // Create OpenSearch vector store with authentication
      const openSearchConfig = {
        endpoint,
        index: idx,
        dimensions,
        textField,
        embeddingField,
        auth: {
          username: "sachin-opensearch",
          password: "Sachin@123"
        }
      };

      // Initialize vector store
      const vectorStore = new OpenSearchVectorStore(openSearchConfig);
      const storageContext = storageContextFromDefaults.fromDefaults({
        vectorStore
      });

      // Initialize an index using our sample data and the client we just created
      const index = await VectorStoreIndex.fromDocuments(documents, {
        storageContext
      });

      // Run query
      const queryEngine = index.asQueryEngine();
      const res = await queryEngine.query("What did the author do growing up?");

      console.log(res);
      expect(res).toBeDefined();
    },
    { timeout: 30000 }
  ); // Increased timeout for async operations
});

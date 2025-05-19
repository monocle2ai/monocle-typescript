import { setupMonocle, startTrace } from '../../dist';

setupMonocle("bedrock-opensearch.app");

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { KnnVectorMethod } from '@opensearch-project/opensearch/api/_types/_common.mapping.js';


// Configuration
const BEDROCK_REGION = "us-east-1";
const OPENSEARCH_DOMAIN = process.env.OPENSEARCH_DOMAIN
const INDEX_NAME = "document-embeddings";
const EMBEDDING_DIMENSION = 1536; // For Titan Text Embeddings
const EMBEDDING_MODEL = "amazon.titan-embed-text-v1";

// Initialize clients
const bedrockClient = new BedrockRuntimeClient({ region: BEDROCK_REGION });

// Initialize OpenSearch client with AWS authentication
const openSearchClient = new Client({
  ...AwsSigv4Signer({
    region: BEDROCK_REGION, // Use the same region or change as needed
    service: 'es', // 'es' for Amazon OpenSearch Service
    getCredentials: () => {
      // Uses the default AWS credential chain
      return new Promise((resolve, reject) => {
        // AWS SDK will automatically load credentials from environment/config
        const credntialProvider = fromNodeProviderChain();
        credntialProvider().then(credentials => {
          resolve(credentials);
        }
        ).catch(err => {
          console.error("Error loading AWS credentials:", err);
          reject(err);
        }
        );
      });
    },
  }),
  node: `https://${OPENSEARCH_DOMAIN}`
});

/**
 * Generate embeddings using AWS Bedrock
 */
async function generateEmbedding(text) {
  const requestPayload = {
    inputText: text
  };

  const command = new InvokeModelCommand({
    modelId: EMBEDDING_MODEL,
    body: JSON.stringify(requestPayload),
    contentType: "application/json",
    accept: "application/json"
  });

  try {
    console.log("Generating embedding with Bedrock model...");
    const response = await bedrockClient.send(command);

    let embedding;
    if (response.body) {
      const responseBody = JSON.parse(Buffer.from(response.body).toString());
      embedding = responseBody.embedding;

      console.log("Embedding generated:", {
        statusCode: response.$metadata.httpStatusCode,
        embeddingDimensions: embedding.length
      });
    }

    return embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    throw error;
  }
}

/**
 * Create KNN index in OpenSearch if it doesn't exist
 */
async function createKnnIndexIfNotExists() {
  try {
    // Check if index exists
    const indexExists = await openSearchClient.indices.exists({
      index: INDEX_NAME
    });

    if (!indexExists.body) {
      console.log(`Creating KNN index ${INDEX_NAME}...`);

      // Define index with KNN settings
      const indexSettings = {
        settings: {
          index: {
            knn: true
          }
        },
        mappings: {
          properties: {
            embedding: {
              type: 'knn_vector' as const,
              dimension: EMBEDDING_DIMENSION,
              method: {
                name: 'hnsw',
                space_type: 'cosinesimil',
                engine: 'nmslib'
              } as KnnVectorMethod
            },
            text: { 
              type: 'text' as const 
            },
            id: { 
              type: 'keyword' as const 
            }
          }
        }
      };

      await openSearchClient.indices.create({
        index: INDEX_NAME,
        body: indexSettings
      });

      console.log(`Index ${INDEX_NAME} created successfully`);
    } else {
      console.log(`Index ${INDEX_NAME} already exists`);
    }

    return true;
  } catch (error) {
    console.error("Error creating KNN index:", error);
    throw error;
  }
}

/**
 * Store document with embedding in OpenSearch
 */
async function storeDocumentEmbedding(id, text, embedding) {
  try {
    const document = {
      id: id,
      text: text,
      embedding: embedding
    };

    const response = await openSearchClient.index({
      index: INDEX_NAME,
      id: id,
      body: document,
      refresh: true // Make it searchable immediately
    });

    console.log(`Document ${id} stored successfully in OpenSearch`);
    return response;
  } catch (error) {
    console.error("Error storing document:", error);
    throw error;
  }
}

/**
 * Query similar documents using KNN search
 */
async function queryKnn(embedding, k = 5) {
  try {
    const queryBody = {
      size: k,
      query: {
        knn: {
          embedding: {
            vector: embedding,
            k: k
          }
        }
      }
    };

    const response = await openSearchClient.search({
      index: INDEX_NAME,
      body: queryBody
    });

    const hits = response.body.hits.hits;
    console.log(`Found ${hits.length} similar documents`);

    return hits.map(hit => ({
      id: hit._source.id,
      text: hit._source.text,
      score: hit._score
    }));
  } catch (error) {
    console.error("Error querying KNN:", error);
    throw error;
  }
}

/**
 * Run the complete workflow
 */
async function runWorkflow() {
  try {
    // Create index if it doesn't exist
    await createKnnIndexIfNotExists();

    // Sample documents
    const documents = [
      { id: "doc1", text: "Coffee is a beverage prepared from roasted coffee beans." },
      { id: "doc2", text: "Tea is an aromatic beverage prepared by pouring hot water over cured leaves." },
      { id: "doc3", text: "Coffee contains caffeine, a stimulant that can improve concentration." },
      { id: "doc4", text: "Water is the most consumed beverage globally." }
    ];

    // Generate embeddings and store documents
    for (const doc of documents) {
      console.log(`Processing document: ${doc.id}`);
      const embedding = await generateEmbedding(doc.text);
      await storeDocumentEmbedding(doc.id, doc.text, embedding);
    }

    console.log("All documents stored in OpenSearch");

    // Query example - find similar documents to a query
    const queryText = "What beverages have caffeine?";
    console.log(`\nQuerying for: "${queryText}"`);

    const queryEmbedding = await generateEmbedding(queryText);
    const similarDocuments = await queryKnn(queryEmbedding, 2);

    console.log("\nSimilar documents:");
    similarDocuments.forEach(doc => {
      console.log(`- ${doc.id} (Score: ${doc.score}): ${doc.text}`);
    });

    return {
      status: "success",
      storedDocuments: documents.length,
      results: similarDocuments
    };
  } catch (error) {
    console.error("Workflow error:", error);
    throw error;
  }
}

if (require.main === module) {
  console.log("Running the workflow...");
  startTrace(() => {
    const val = runWorkflow()

      val.then(() => console.log("Workflow completed successfully"))
      .catch(error => console.error("Workflow failed:", error));
      
    return val
  })
}

const wrappedRunWorkflow = () => {
  return startTrace(() => {
    const val = runWorkflow()

      val.then(() => console.log("Workflow completed successfully"))
      .catch(error => console.error("Workflow failed:", error));
      
    return val
  })
};

export {
  wrappedRunWorkflow as main,
};


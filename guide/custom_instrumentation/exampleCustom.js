const { INFERENCE_OUTPUT_PROCESSOR } = require('./monocle_output_processor/outputProcessorInference');
const { VECTOR_OUTPUT_PROCESSOR } = require('./monocle_output_processor/outputProcessorVector');
const { setupMonocle } = require('monocle2ai');

// Set up instrumentation
setupMonocle(
  "openai.app",
  [],
  [
    {

      "package": require.resolve('./custom_ai_code/openaiClient'),
      "object": "OpenAIClient",
      "method": "chat",
      "spanName": "openaiClient.chat",
      "output_processor": [
        INFERENCE_OUTPUT_PROCESSOR
      ]
    },
    {

      "package": require.resolve('./custom_ai_code/vectorDb'),
      "object": "InMemoryVectorDB",
      "method": "searchByText",
      "spanName": "vectorDb.searchByText",
      "output_processor": [
        VECTOR_OUTPUT_PROCESSOR
      ]
    }
  ]
);

require('dotenv').config();
const { OpenAIClient } = require('./custom_ai_code/openaiClient');
const InMemoryVectorDB = require('./custom_ai_code/vectorDb');

async function main() {
  try {
    // Initialize clients
    const client = new OpenAIClient();
    const vectorDb = new InMemoryVectorDB();

    // Store some example texts
    console.log("Storing example texts in vector database...");
    await vectorDb.storeText(
      "doc1",
      "JavaScript is a high-level programming language",
      { source: "programming-docs" }
    );

    await vectorDb.storeText(
      "doc2",
      "Machine learning is a subset of artificial intelligence",
      { source: "ml-docs" }
    );

    // Search using text query
    console.log("\nSearching vector database...");
    const results = await vectorDb.searchByText("programming languages", 2);

    console.log("\nVector search results:");
    for (const result of results) {
      console.log(`ID: ${result.id}, Similarity: ${result.similarity.toFixed(3)}`);
      console.log(`Text: ${result.metadata.text || ''}`);
    }

    // OpenAI example
    console.log("\nSending request to OpenAI...");
    const systemPrompts = ["You are a helpful AI assistant."];
    const userPrompts = ["Tell me a short joke about programming."];
    const messages = client.formatMessages(systemPrompts, userPrompts);

    const response = await client.chat(messages, "gpt-3.5-turbo", 0.7);

    console.log("\nOpenAI response:");
    console.log(response.choices[0].message.content);

  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();

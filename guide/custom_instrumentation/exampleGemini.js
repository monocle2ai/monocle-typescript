const { GEMINI_OUTPUT_PROCESSOR } = require('./monocle_output_processor/outputProcessorGemini');
const { VECTOR_OUTPUT_PROCESSOR } = require('./monocle_output_processor/outputProcessorVector');
const { setupMonocle } = require('monocle2ai');

// Set up instrumentation
setupMonocle(
  "gemini.app",
  [],
  [
    {
      "package": "@google/generative-ai",
      "object": "GenerativeModel",
      "method": "generateContent",
      "spanName": "gemini.generateContent",
      "output_processor": [
        GEMINI_OUTPUT_PROCESSOR
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
const InMemoryVectorDB = require('./custom_ai_code/vectorDb');
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function main() {
  try {
    // Initialize Google Generative AI client
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment variables");
    }
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    // Initialize vector DB
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

    // Gemini API example
    console.log("\nSending request to Gemini API...");
    
    // Create chat session with system instructions
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: "You are a helpful AI assistant." }],
        },
        {
          role: "model",
          parts: [{ text: "I'll do my best to help as a helpful assistant." }],
        }
      ],
      generationConfig: {
        temperature: 0.7,
      }
    });

    // Send message to Gemini
    const result = await model.generateContent("Tell me a short joke about programming.");
    const response = result.response;
    
    console.log("\nGemini response:");
    console.log(response.text());

  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();

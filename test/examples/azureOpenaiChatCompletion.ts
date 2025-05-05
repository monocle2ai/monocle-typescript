import { setupMonocle } from '../../src';
import { OpenAI } from "openai";

setupMonocle("azure-openai.app");

const client = new OpenAI({
  apiKey: process.env["AZURE_OPENAI_API_KEY"],
  baseURL: process.env["AZURE_OPENAI_ENDPOINT_1"], // Azure endpoint URL
  defaultQuery: { "api-version": "2023-05-15" }, // API version
//   defaultHeaders: { "api-key": process.env["AZURE_OPENAI_API_KEY"] }
});

async function main() {

  const chatCompletion = await client.chat.completions.create({
    messages: [
      { role: "user", content: "What is an americano?" },
      {
        role: "system",
        content: "You are a helpful assistant to answer questions about coffee."
      }
    ],
    model: process.env["AZURE_OPENAI_API_DEPLOYMENT"] || "gpt-4o" // Use Azure deployment name
  });
  console.log("Chat Completion Result:");
  console.log(chatCompletion.choices[0].message.content);


  const embeddingClient = new OpenAI({
    apiKey: process.env["AZURE_OPENAI_API_KEY"],
    baseURL: process.env["AZURE_OPENAI_EMBEDDING_ENDPOINT"], // Azure endpoint URL
    defaultQuery: { "api-version": "2023-05-15" }, // API version
  });
  // Embedding
  const embeddingResponse = await embeddingClient.embeddings.create({
    model: "",
    input: "What is an americano?",
    encoding_format: "float"
  });

  // Get the embedding vector
  const embedding = embeddingResponse.data[0].embedding;

  console.log("\nEmbedding Result:");
  console.log(`Generated a vector with ${embedding.length} dimensions`);
  //   console.log("First 5 dimensions:", embedding.slice(0, 5));
}

if (require.main === module) {
  main().catch(console.error);
}

export { main };

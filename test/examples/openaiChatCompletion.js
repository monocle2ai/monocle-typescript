const { setupMonocle } = require("../../dist");

setupMonocle("openai.app");

const { OpenAI } = require("openai");

const client = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"] // This is the default and can be omitted
});

async function main() {
  // Chat completion
  const chatCompletion = await client.chat.completions.create({
    messages: [{ role: "user", content: "Say this is a test" }],
    model: "gpt-4o"
  });
  console.log("Chat Completion Result:");
  console.log(chatCompletion.choices[0].message.content);

  // Embedding
  const embeddingResponse = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: "The quick brown fox jumps over the lazy dog",
    encoding_format: "float"
  });

  // Get the embedding vector
  const embedding = embeddingResponse.data[0].embedding;

  console.log("\nEmbedding Result:");
  console.log(`Generated a vector with ${embedding.length} dimensions`);
  console.log("First 5 dimensions:", embedding.slice(0, 5));
}

main().catch((error) => {
  console.error("Error occurred:", error);
});

const { setupMonocle } = require("../../dist");

setupMonocle("openai.app");

const { OpenAI } = require("openai");

const client = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"] // This is the default and can be omitted
});

export async function main() {
  // Chat completion
  const chatCompletion = await client.chat.completions.create({
    messages: [
      { role: "user", content: "What is an americano?" },
      {
        role: "system",
        content: "You are a helpful assistant to answer questions about coffee."
      }
    ],
    model: "gpt-4o"
  });
  console.log("Chat Completion Result:");
  console.log(chatCompletion.choices[0].message.content);

  // Embedding
  const embeddingResponse = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: "What is an americano?",
    encoding_format: "float"
  });

  // Get the embedding vector
  const embedding = embeddingResponse.data[0].embedding;

  console.log("\nEmbedding Result:");
  console.log(`Generated a vector with ${embedding.length} dimensions`);
  //   console.log("First 5 dimensions:", embedding.slice(0, 5));
}

// Only run if this file is being executed directly (not imported)
if (require.main === module) {
  main().catch((error) => {
    console.error("Error occurred:", error);
  });
}

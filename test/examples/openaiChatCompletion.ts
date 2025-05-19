import { setupMonocle } from '../../dist';
setupMonocle("openai.app");

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"], // This is the default and can be omitted
});

async function main() {
  // Chat completion
  const chatCompletion = await client.chat.completions.create({
    messages: [
      { role: "user", content: "What is an americano?" },
      {
        role: "system",
        content:
          "You are a helpful assistant to answer questions about coffee.",
      },
    ],
    model: "gpt-4o",
  });
  console.log("Chat Completion Result:");
  console.log(chatCompletion.choices[0].message.content);

  // Embedding
  const embeddingResponse = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: "What is an americano?",
    encoding_format: "float",
  });

  // Get the embedding vector
  const embedding = embeddingResponse.data[0].embedding;

  console.log("\nEmbedding Result:");
  console.log(`Generated a vector with ${embedding.length} dimensions`);

  const response = await client.responses.create({
    model: "gpt-4o",
    input: "what is an americano?",
  });
  const response2 = await client.responses.create({
    model: "gpt-4o",
    instructions: "You are a coding assistant that talks like a pirate",
    input: "Are semicolons optional in JavaScript?",
  });
  console.log(response.output_text);
  console.log(response2.output_text);
}

if (require.main === module) {
  main().catch(console.error);
}

export { main };

const { setupMonocle } = require("../../dist");

setupMonocle("openai.app");

const { OpenAI } = require("openai");

async function openaiChat(client) {
  // Chat completion
  try {
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
  } catch (error) {
    console.error("Error during chat completion:", error);
  }

  // Embedding
  try {
    const embeddingResponse = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: "What is an americano?",
      encoding_format: "float",
    });

    // Get the embedding vector
    const embedding = embeddingResponse.data[0].embedding;

    console.log("\nEmbedding Result:");
    console.log(`Generated a vector with ${embedding.length} dimensions`);
  } catch (error) {
    console.error("Error during embedding generation:", error);
  }

  try {
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
  } catch (error) {
    console.error("Error during response generation:", error);
  }
}


async function main() {

  try {
    const validClient = new OpenAI({
      apiKey: process.env["OPENAI_API_KEY"],
    });

    // INVALID API key client
    const invalidClient = new OpenAI({
      apiKey: "INVALID_KEY",
    });

    await openaiChat(validClient);
    await openaiChat(invalidClient);
  } catch (e) {
    console.error("Error during openAI chat:", e);
  }
}

if (require.main === module) {
  (async () => {
    try {
      await main();
    } catch (e) {
      console.error("Error during processing:", e);
    }
    // Wait 5 seconds then exit
    setTimeout(() => {
      console.log("Exiting after 5 seconds...");
      process.exit(0); // force clean exit
    }, 5_000);
  })();
}

module.exports = { main };

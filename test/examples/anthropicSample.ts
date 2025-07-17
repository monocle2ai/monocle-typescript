import { setupMonocle } from "../../dist";
setupMonocle("anthropic.app");

import { Anthropic } from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY || "your-api-key";

const client = new Anthropic({
  apiKey: apiKey,
});

async function main() {
  // Message completion
  const messageCompletion = await client.messages.create({
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 1024,
    messages: [
      { role: "user", content: "What is an americano?" },
    ],
    system: "You are a helpful assistant to answer questions about coffee."
  });
  console.log("Message Completion Result:");
  const content = messageCompletion.content[0];
  if ("text" in content) {
    console.log("Message completion successful");
    console.log("Response:", content.text);
  }

  // Message streaming
  const stream = await client.messages.create({
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 1024,
    messages: [
      { role: "user", content: "What is an americano?" },
    ],
    system: "You are a helpful assistant to answer questions about coffee.",
    stream: true,
  });

  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && "text" in chunk.delta) {
      process.stdout.write(chunk.delta.text);
    }
  }
  process.stdout.write("\n\n");

  // Message completion with invalid API key
  // This is to demonstrate error handling;
  const invalidClient = new Anthropic({
    apiKey: "invalid-api-key",
  });

  const messageCompletionInvalid = await invalidClient.messages.create({
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 100,
    messages: [{ role: "user", content: "Hello?" }],
    system: "You are a helpful assistant.",
  });

  console.log("Message Completion Result:");
  const contentInvalid = messageCompletionInvalid.content[0];
  if ("text" in contentInvalid) {
    console.log("Message completion successful");
    console.log("Response:", contentInvalid.text);
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

export { main };
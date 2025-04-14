const { setupMonocle } = require("../../dist");

setupMonocle("anthropic.app");

const { Anthropic } = require("@anthropic-ai/sdk");

const client = new Anthropic({
  apiKey: process.env["ANTHROPIC_API_KEY"], 
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
  console.log(messageCompletion.content[0].text);

  // Message streaming
  const stream = await client.messages.stream({
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 1024,
    messages: [
      { role: "user", content: "What is an americano?" },
    ],
    system: "You are a helpful assistant to answer questions about coffee."
  });

  console.log("Streaming Result:", stream);
  
}

exports.main = main;

if (require.main === module) {
  main().catch((error) => {
    console.error("Error occurred:", error);
  });
}
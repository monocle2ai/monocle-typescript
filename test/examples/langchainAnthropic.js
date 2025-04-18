const { setupMonocle } = require("../../dist");

setupMonocle("anthropic.app");

const { ChatAnthropic } = require("@langchain/anthropic");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");

// Initialize the LangChain Anthropic chat model
const model = new ChatAnthropic({
  modelName: "claude-3-5-sonnet-20240620",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  maxTokens: 1024,
});

async function main() {
  // Regular completion
  const messages = [
    new SystemMessage(
      "You are a helpful assistant to answer questions about coffee."
    ),
    new HumanMessage("What is an americano?"),
  ];

  const response = await model.invoke(messages);
  console.log("Regular Completion Result:");
  console.log(response.content);

  // Streaming completion
  const stream = await model.stream(messages);
  console.log("\nStreaming Result:");

  for await (const chunk of stream) {
    process.stdout.write(chunk.content);
  }
  console.log("\n");

  // Using with output parser (alternative approach)
  const chain = model
    .pipe(new StringOutputParser())
    .pipe((output) => `Processed: ${output}`);

  const chainResult = await chain.invoke(messages);
  console.log("\nChain Result:");
  console.log(chainResult);
}

exports.main = main;

if (require.main === module) {
  main().catch((error) => {
    console.error("Error occurred:", error);
  });
}

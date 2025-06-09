import { setupMonocle } from '../../dist';
setupMonocle("anthropic.app");

import { ChatAnthropic } from "@langchain/anthropic";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

async function main(model) {
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
    process.stdout.write(chunk.content as string);
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

export { main };

if (require.main === module) {
  (async () => {
    try {
      const validClient = new ChatAnthropic({
        modelName: "claude-3-5-sonnet-20240620",
        anthropicApiKey: process.env.ANTHROPIC_API_KEY, // Set this in your environment
        maxTokens: 1024,
      });

      // INVALID API key client
      const invalidClient = new ChatAnthropic({
        modelName: "claude-3-5-sonnet-20240620",
        anthropicApiKey: "INVALID_KEY",
        maxTokens: 1024,
      });

      await main(validClient);
      await main(invalidClient);
    } catch (e) {
      console.error("Error during execution:", e);
    }

    // Wait 5 seconds then exit
    setTimeout(() => {
      console.log("Exiting after 5 seconds...");
      process.exit(0); // force clean exit
    }, 5_000);
  })();
}

const { setupMonocle } = require("../../dist");
setupMonocle("google-genai.app");

const {
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");


async function langchainGeminiChat(model) {
  try {
    // Test 1: Simple string input
    console.log("Test 1: Simple string input");
    const simpleResponse = await model.invoke("Hello! What is an americano coffee?");
    console.log("Simple Response:");
    console.log(simpleResponse.content);

    // Test 2: Using proper message format
    console.log("\nTest 2: Using message format");
    const messages = [
      new HumanMessage("What is an americano coffee?")
    ];
    const messageResponse = await model.invoke(messages);
    console.log("Message Response:");
    console.log(messageResponse.content);

    // Test 3: With system message
    console.log("\nTest 3: With system message");
    const systemMessages = [
      new SystemMessage("You are a helpful coffee expert."),
      new HumanMessage("What is an americano?")
    ];
    const systemResponse = await model.invoke(systemMessages);
    console.log("System Message Response:");
    console.log(systemResponse.content);

    // Test 4: Streaming
    console.log("\nTest 4: Streaming response");
    const stream = await model.stream("Tell me about coffee in one sentence.");
    for await (const chunk of stream) {
      process.stdout.write(chunk.content);
    }
    console.log("\n");

    // Test 5: Using with output parser
    console.log("\nTest 5: Using with output parser");
    const chain = model.pipe(new StringOutputParser());
    const chainResult = await chain.invoke("What is espresso?");
    console.log("Chain Result:");
    console.log(chainResult);

  } catch (error) {
    console.error("Error in main function:", error.message);
    throw error;
  }
}


async function main() {
  try {
      const validClient = new ChatGoogleGenerativeAI({
        model: "gemini-1.5-pro",
        maxOutputTokens: 2048,
        temperature: 0.7,
      });

      await langchainGeminiChat(validClient);

    } catch (e) {
      console.error("Error during execution:", e.message);
      console.error("Stack trace:", e.stack);
    }
}


module.exports = { main };

if (require.main === module) {
  (async () => {
      await main();
      // Wait 5 seconds then exit
      setTimeout(() => {
        console.log("Exiting after 5 seconds...");
        process.exit(0);
      }, 5_000);
    })();
}

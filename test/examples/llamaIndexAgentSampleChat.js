const { setupMonocle } = require("../../dist");
setupMonocle("llamaindex.multi_agent");

const { openai } = require("@llamaindex/openai");
const { agent } = require("@llamaindex/workflow");
const { tool } = require("llamaindex");
const { z } = require("zod");

async function llamaIndexAgentChat() {
  const sumNumbers = tool({
    name: "sumNumbers",
    description: "Use this function to sum two numbers",
    parameters: z.object({
      a: z.number().describe("The first number"),
      b: z.number().describe("The second number"),
    }),
    execute: ({ a, b }) => `${a + b}`,
  });

  const divideNumbers = tool({
    name: "divideNumbers",
    description: "Use this function to divide two numbers",
    parameters: z.object({
      a: z.number().describe("The dividend a to divide"),
      b: z.number().describe("The divisor b to divide by"),
    }),
    execute: ({ a, b }) => `${a / b}`,
  });

  const mathAgent = agent({
    tools: [sumNumbers, divideNumbers],
    llm: openai({ model: "gpt-4" }),
    verbose: false,
  });

  const response = await mathAgent.run("How much is 5 + 5? then divide by 2");
  console.log(response.data);
}

async function main() {
  try {
    await llamaIndexAgentChat();
  } catch (e) {
    console.error("Error during llamaIndex processing:", e);
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
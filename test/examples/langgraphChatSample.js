const { setupMonocle } = require("../../dist");
setupMonocle("langgraph.opensearch.app");

const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { tool } = require("@langchain/core/tools");
const { ChatOpenAI } = require("@langchain/openai");

async function langGraphChat() {
  const getTime = tool(
    async () => {
      return { time: new Date().toISOString() };
    },
    {
      name: "get_time",
      description: "Returns the current time",
    }
  );

  const getWeather = tool(
    async ({ location }) => {
      return { weather: `Sunny, 25°C in ${location}` };
    },
    {
      name: "get_weather",
      description: "Gets weather information for a location",
    }
  );

  const calculator = tool(
    async ({ expression }) => {
      try {
        const result = eval(expression);
        return { result };
      } catch (error) {
        return { error: "Invalid expression" };
      }
    },
    {
      name: "calculator",
      description: "Performs basic mathematical calculations",
    }
  );

  const getRandomNumber = tool(
    async ({ min, max }) => {
      const randomNum = Math.floor(Math.random() * (max - min + 1)) + min;
      return { number: randomNum };
    },
    {
      name: "get_random_number",
      description: "Generates a random number between min and max",
    }
  );

  const model = new ChatOpenAI({
    modelName: "gpt-4",
    temperature: 0,
  });

  const agent = createReactAgent({
    llm: model,
    tools: [getTime, getWeather, calculator, getRandomNumber],
    verbose: true,
  });

  // Call the agent
  try {
    const result = await agent.invoke({
      messages: [{ role: "user", content: "What time is it and what's the weather like in New York?" }],
    });

    console.log("Response:", result);
  } catch (error) {
    console.error("Error during LangGraph chat:", error);
  }
}

async function main() {
  try {
    await langGraphChat();
  } catch (e) {
    console.error("Error during LangGraph processing:", e);
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

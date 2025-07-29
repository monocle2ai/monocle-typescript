const { setupMonocle } = require("../../dist");
setupMonocle("langgraph.agent");

const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { tool } = require("@langchain/core/tools");
const { ChatOpenAI } = require("@langchain/openai");

async function langGraphChat() {
  const getCoffeeMenu = tool(
    async () => {
      return [
        "espresso: A strong and bold coffee shot.",
        "latte: A smooth coffee with steamed milk.",
        "cappuccino: A rich coffee with frothy milk foam.",
        "americano: Espresso with added hot water for a milder taste.",
        "mocha: A chocolate-flavored coffee with whipped cream."
      ].join("\n");
    },
    {
      name: "getCoffeeMenu",
      description: "Returns the available coffee menu.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  );

  
  const orderCoffee = tool(
    async ({ order }) => {
      const coffeeMenu = ["espresso", "latte", "cappuccino", "americano", "mocha"];
      if (coffeeMenu.includes(order)) {
        return `Your ${order} is being prepared. Enjoy your coffee!`;
      }
      return "Sorry, we don’t have that coffee option. Please choose from the menu.";
    },
    {
      name: "orderCoffee",
      description: "Processes a coffee order and returns confirmation or error.",
      parameters: {
        type: "object",
        properties: {
          order: {
            type: "string",
            description: "The name of the coffee to order"
          }
        },
        required: ["order"]
      }
    }
  );

  const getCoffeeDetails = tool(
    async ({ coffeeName }) => {
      const menu = {
        "espresso": "A strong and bold coffee shot.",
        "latte": "A smooth coffee with steamed milk.",
        "cappuccino": "A rich coffee with frothy milk foam.",
        "americano": "Espresso with added hot water for a milder taste.",
        "mocha": "A chocolate-flavored coffee with whipped cream."
      };

      return menu[coffeeName] ?? "Sorry, we don’t have details for that coffee.";
    },
    {
      name: "getCoffeeDetails",
      description: "Provides details about a specific coffee.",
      parameters: {
        type: "object",
        properties: {
          coffeeName: {
            type: "string",
            description: "The name of the coffee to get details about"
          }
        },
        required: ["coffeeName"]
      }
    }
  );


  const model = new ChatOpenAI({
    modelName: "gpt-4",
    temperature: 0,
  });

  const agent = createReactAgent({
    llm: model,
    tools: [getCoffeeMenu, orderCoffee, getCoffeeDetails],
    verbose: true,
  });

  // Call the agent
  try {
    const result = await agent.invoke({
      messages: [{ role: "user", content: "show available coffee option" }],
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

const { setupMonocle } = require("../../dist");
setupMonocle("llamaindex.agent");

const { openai } = require("@llamaindex/openai");
const { agent } = require("@llamaindex/workflow");
const { FunctionTool } = require("@llamaindex/core/tools");
const { Settings } = require("@llamaindex/core/global");

async function llamaIndexAgentChat() {
  Settings.llm = openai({ model: "gpt-4" });
  const getCoffeeMenu = FunctionTool.from(
    async (_) => {
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
        properties: {}, // no input parameters
        required: []
      }
    }
  );

  const orderCoffee = FunctionTool.from(
    async ({ order }) => {
      const coffeeMenu = ["espresso", "latte", "cappuccino", "americano", "mocha"];
      const normalizedOrder = order.toLowerCase();
      if (coffeeMenu.includes(normalizedOrder)) {
        return `Your ${normalizedOrder} is being prepared. Enjoy your coffee!`;
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

  const getCoffeeDetails = FunctionTool.from(
    async ({ coffeeName }) => {
      const menu = {
        espresso: "A strong and bold coffee shot.",
        latte: "A smooth coffee with steamed milk.",
        cappuccino: "A rich coffee with frothy milk foam.",
        americano: "Espresso with added hot water for a milder taste.",
        mocha: "A chocolate-flavored coffee with whipped cream."
      };

      const normalized = coffeeName.toLowerCase();
      return menu[normalized] ?? "Sorry, we don’t have details for that coffee.";
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

  const coffeeAgent = agent({
    tools: [getCoffeeMenu, orderCoffee, getCoffeeDetails],
    // llm: openai({ model: "gpt-4" }),
    verbose: false,
  });

  const response = await coffeeAgent.run("order 3 Americano coffee and get details about it");
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
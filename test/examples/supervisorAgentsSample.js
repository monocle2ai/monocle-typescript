const { setupMonocle } = require("../../dist");
setupMonocle("langgraph.multi_agent");

const { z } = require("zod");

const { ChatOpenAI } = require("@langchain/openai");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { createSupervisor } = require("@langchain/langgraph-supervisor");
const { tool } = require("@langchain/core/tools");


const model = new ChatOpenAI({ modelName: "gpt-4o" });

// Create specialized agents
const bookHotel = tool(
    async () => {
        return { bookingId: 'H-' + Math.floor(Math.random() * 10000) };
    },
    {
        name: "bookHotel",
        description: "Books a hotel and returns a random booking ID.",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
);


const hotelAssistant = createReactAgent({
    llm: model,
    tools: [bookHotel],
    prompt: 'You are a hotel booking assistant',
    name: 'hotel_assistant',
});

const bookFlight = tool(
    async () => {
        return { bookingId: 'FL-' + Math.floor(Math.random() * 10000) };
    },
    {
        name: "bookFlight",
        description: "Books a flight and returns a random booking ID.",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
);
const flightAssistant = createReactAgent({
    llm: model,
    tools: [bookFlight],
    prompt: 'You are a flight booking assistant',
    name: 'flight_assistant',
});


const currencyConversion = tool(
    async (amount, from, to) => {
        const rate = Math.random() * (1.5 - 0.5) + 0.5; // random rate between 0.5 and 1.5
        return { converted: amount * rate, rate };
    },
    {
        name: 'currencyConversion',
        description: 'Converts currency and returns a random conversion value.',
        parameters: {
            type: 'object',
            properties: {
                amount: { type: 'number' },
                from: { type: 'string' },
                to: { type: 'string' }
            },
            required: ['amount', 'from', 'to']
        }
    }
);

const workflow = createSupervisor({
    agents: [hotelAssistant, flightAssistant],
    tools: [currencyConversion],
    llm: model,
    prompt:
        `You manage a hotel booking assistant and a flight booking assistant.
        Assign work to them.
        Use the currency conversion tool for converting currencies. Don't use approximate conversions.`
});

async function main() {
    const app = workflow.compile();
    const result = await app.invoke({
        messages: [
            {
                role: "user",
                content: "Book a flight from San Francisco to New York and book a hotel in New York and share both booking id. Also convert 1 USD to EUR."
            }
        ]
    });
    // console.log(result);
}

if (require.main === module) {
    main();
}

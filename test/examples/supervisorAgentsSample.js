const { setupMonocle } = require("../../dist");
setupMonocle("langgraph.multi_agent");

const { ChatOpenAI } = require("@langchain/openai");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { createSupervisor } = require("@langchain/langgraph-supervisor");
const { tool } = require("@langchain/core/tools");
const { McpServerTester } = require("./mcpServers");
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js'); // <-- add this

const model = new ChatOpenAI({ modelName: "gpt-4o" });

const mcpServer = new McpServerTester();

async function getTools() {
    try {
        await mcpServer.startServer();
    } catch (error) {
        console.error('Error starting MCP Server:', error);
    }

    const clientTransport = new StreamableHTTPClientTransport(`http://localhost:3000/mcp`);
    const mcpClient = new Client(
        {
            name: 'json-response-streamable-http-client',
            version: '1.0.0',
        },
        {
            capabilities: { elicitation: {} },
        }
    );

    await mcpClient.connect(clientTransport);

    const tools = await mcpClient.listTools();
    return tools
}

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

async function main() {
    const mcpTools = await getTools();
    const langchainMcpTools = mcpTools["tools"].map(mcpTool => {
        return tool(
            async (args) => {
                const clientTransport = new StreamableHTTPClientTransport(
                    new URL(`http://localhost:3000/mcp`),
                    { enableJsonResponse: true });
                const mcpClient = new Client({
                    name: 'json-response-streamable-http-client',
                    version: '1.0.0',
                }, {
                    capabilities: { elicitation: {} },
                });
                await mcpClient.connect(clientTransport);
                const result = await mcpClient.callTool({
                    name: mcpTool.name,
                    arguments: { expression: args }
                });
                return result.content[0]?.text || 'No result';
            },
            {
                name: mcpTool.name,
                description: mcpTool.description,
                parameters: mcpTool.inputSchema || {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        );
    });

    const workflow = createSupervisor({
        agents: [hotelAssistant, flightAssistant],
        tools: [currencyConversion, ...langchainMcpTools],
        llm: model,
        prompt:
            `You manage a hotel booking assistant and a flight booking assistant.\nAssign work to them.\nUse the currency conversion tool for converting currencies. Don't use approximate conversions.\nYou can also use the calculate tool for advanced math queries.`
    });

    const app = workflow.compile();
    const result = await app.invoke({
        messages: [
            {
                role: "user",
                content: "Book a flight from San Francisco to New York and book a hotel in New York and share both booking id. Also convert 1 USD to EUR. what is the result of 7 * 8"
            }
        ],
    });
    console.log('Result:', result);
    await new Promise(resolve => setTimeout(resolve, 5000));
    await mcpServer.stopServer();
}

if (require.main === module) {
    main();
}

module.exports = { main };
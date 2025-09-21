const { setupMonocle } = require("../../dist");
setupMonocle("openai.agents", [], [], 'console');

const { Agent, run, tool, MCPServerStreamableHttp } = require('@openai/agents');
const { McpServerTester } = require("./mcpServers");
const { z } = require('zod');

const getWeatherTool = tool({
    name: 'get_weather',
    description: 'Get the current weather for a specific city. Always use this tool when asked about weather.',
    parameters: z.object({ city: z.string() }),
    execute: async (input) => {
        console.log(`Weather tool called for city: ${input.city}`);
        return `The weather in ${input.city} is sunny with a temperature of 75°F`;
    },
});

const getTemperatureTool = tool({
    name: 'get_temperature',
    description: 'Get the current temperature for a specific city. Always use this tool when asked about temperature.',
    parameters: z.object({ city: z.string() }),
    execute: async (input) => {
        console.log(`Temperature tool called for city: ${input.city}`);
        return `The temperature in ${input.city} is 75°F`;
    },
});

async function main() {
    // Start the MCP server
    const mcpServerTester = new McpServerTester();
    let mcpServer = null;

    try {
        console.log('🚀 Starting MCP server...');
        await mcpServerTester.startServer();

        // Wait a moment for server to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create MCP server instance for OpenAI agents
        mcpServer = new MCPServerStreamableHttp({
            url: 'http://localhost:3000/mcp',
            name: 'math-calculator-server',
            timeout: 30000
        });

        console.log('Connecting to MCP server...');
        await mcpServer.connect();

        console.log('Creating agent with MCP server...');

        // Create agent with both local get weather tool and MCP server
        const agent = new Agent({
            name: 'Enhanced Weather Assistant',
            instructions: `You are a helpful assistant with weather and temperature capabilities.`,
            tools: [getWeatherTool, getTemperatureTool],
            mcpServers: [mcpServer]
        });

        console.log('Running calculation and weather request...');
        const result = await run(
            agent,
            'Get the current weather and temperature for Delhi, and calculate 15 + 27 multiplied by 3',
        );

        console.log('Result:', result.finalOutput);

    } catch (error) {
        console.error('Error during execution:', error);
    } finally {
        // Clean up
        console.log('Cleaning up...');
        try {
            if (mcpServer) {
                console.log('Closing MCP server connection...');
                await mcpServer.close();
            }
        } catch (closeError) {
            console.log('Note: MCP server may have already been closed');
        }

        // await new Promise(resolve => setTimeout(resolve, 2000));
        await mcpServerTester.stopServer();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

main().catch(console.error);

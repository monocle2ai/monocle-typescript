const { setupMonocle } = require("../../dist");
setupMonocle("openai.agents", [], [], 'file');

const { Agent, run, tool, MCPServerStreamableHttp } = require('@openai/agents');
const { McpServerTester } = require("./mcpServers");
const { z } = require('zod');

const getWeatherTool = tool({
  name: 'get_weather',
  description: 'Get the weather for a given city',
  parameters: z.object({ city: z.string() }),
  execute: async (input) => {
    return `The weather in ${input.city} is sunny`;
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
            name: 'Enhanced Weather and Mathematical Assistant',
            instructions: `You are a helpful assistant with access to both a local get weather tool and an MCP server with mathematical capabilities.
                            Available tools:
                            - get_weather: Get the weather for a given city
                            - MCP server tools: Additional mathematical tools from the MCP server
                            Use the appropriate tool based on the user's request.`,
            tools: [getWeatherTool],
            mcpServers: [mcpServer]
        });

        console.log('Running random number and calculation request...');
        const result = await run(
            agent,
            'Get the weather for New York City. Also calculate 15 + 27 using whatever tools you have available.',
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

        await new Promise(resolve => setTimeout(resolve, 2000));
        await mcpServerTester.stopServer();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

main().catch(console.error);

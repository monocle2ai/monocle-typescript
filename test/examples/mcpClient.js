const { setupMonocle } = require("../../dist");
setupMonocle("mcp.test");

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { McpServerTester } = require("./mcpServers");

async function testMcpClient() {
    const mcpServer = new McpServerTester();

    try {
        await mcpServer.startServer();
        console.log(`✅ MCP Server started on port 3000`);

        // Wait a bit for server to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
        console.error('Error starting MCP Server:', error);
        return;
    }

    const clientTransport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:3000/mcp`), 
        { enableJsonResponse: true });

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

    // First list available tools
    const tools = await mcpClient.listTools();
    console.log('Available tools:', tools, tools[0]);

    // Then call the calculate tool with proper parameters
    const result = await mcpClient.callTool({
        name: 'calculate',
        arguments: { expression: "8*8" }
    });
    console.log('Calculate result:', result);

    // Cleanup
    await mcpServer.stopServer();
}

testMcpClient();
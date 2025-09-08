const { setupMonocle } = require("../../dist");
setupMonocle("openai.agents.mcp");

const { Agent, run, MCPServerStdio, getAllMcpTools } = require('@openai/agents');
const path = require('path');

// Simple MCP server simulation for testing
// In a real scenario, you would connect to an actual MCP server
class MockMCPServer {
    constructor(name) {
        this.serverName = name;
        this.cacheToolsList = true;
    }

    get name() {
        return this.serverName;
    }

    async connect() {
        console.log(`Connected to MCP server: ${this.name}`);
    }

    async close() {
        console.log(`Closed connection to MCP server: ${this.name}`);
    }

    async listTools() {
        return [
            {
                name: 'weather_lookup',
                description: 'Get current weather for a location',
                inputSchema: {
                    type: 'object',
                    properties: {
                        location: {
                            type: 'string',
                            description: 'The city and state/country to get weather for'
                        }
                    },
                    required: ['location'],
                    additionalProperties: false
                }
            },
            {
                name: 'file_search',
                description: 'Search for files in a directory',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: {
                            type: 'string',
                            description: 'Directory path to search in'
                        },
                        pattern: {
                            type: 'string',
                            description: 'File name pattern to search for'
                        }
                    },
                    required: ['directory', 'pattern'],
                    additionalProperties: false
                }
            }
        ];
    }

    async callTool(toolName, args) {
        console.log(`MCP Server calling tool: ${toolName} with args:`, args);
        
        switch (toolName) {
            case 'weather_lookup':
                return [{
                    type: 'text',
                    text: `The current weather in ${args.location} is 72°F and sunny with light clouds.`
                }];
            
            case 'file_search':
                return [{
                    type: 'text',
                    text: `Found 3 files matching pattern "${args.pattern}" in ${args.directory}:\n- example1.txt\n- example2.log\n- data.json`
                }];
            
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    async invalidateToolsCache() {
        console.log(`Invalidated tools cache for ${this.name}`);
    }
}

async function createMCPServerExample() {
    // Create a mock MCP server
    const mcpServer = new MockMCPServer('weather-and-files-server');
    
    // Connect to the server
    await mcpServer.connect();
    
    // Get all tools from the MCP server
    console.log('Loading tools from MCP server...');
    const mcpTools = await getAllMcpTools([mcpServer]);
    
    console.log(`Loaded ${mcpTools.length} tools from MCP server:`, mcpTools.map(t => t.name));
    
    // Create an agent with MCP tools
    const agent = new Agent({
        name: 'MCP Assistant',
        instructions: `You are a helpful assistant with access to weather information and file search capabilities via MCP tools. 
        
Available tools:
- weather_lookup: Get current weather for any location
- file_search: Search for files in directories

Use these tools when users ask about weather or need to find files.`,
        tools: mcpTools
    });

    return { agent, mcpServer };
}

async function main() {
    try {
        console.log('Setting up MCP server and agent...');
        const { agent, mcpServer } = await createMCPServerExample();
        
        console.log('\n--- Running agent with MCP tools ---');
        
        // Test weather lookup
        console.log('\n🌤️  Testing weather lookup...');
        const weatherResult = await run(
            agent,
            'What is the current weather in San Francisco, CA?'
        );
        console.log('Weather response:', weatherResult.finalOutput);
        
        // Test file search
        console.log('\n📁 Testing file search...');
        const fileResult = await run(
            agent,
            'Can you search for .txt files in the /home/user/documents directory?'
        );
        console.log('File search response:', fileResult.finalOutput);
        
        // Test multiple tools in one conversation
        console.log('\n🔄 Testing multiple tools...');
        const multiResult = await run(
            agent,
            'What is the weather in New York and also search for .log files in /var/logs?'
        );
        console.log('Multi-tool response:', multiResult.finalOutput);
        
        // Clean up
        await mcpServer.close();
        
    } catch (error) {
        console.error('Error running MCP example:', error);
    }
}

// Run the example
main().catch(console.error);

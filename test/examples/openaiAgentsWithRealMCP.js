const { setupMonocle } = require("../../dist");
setupMonocle("openai.agents.mcp.real");

const { Agent, run, MCPServerStdio, getAllMcpTools } = require('@openai/agents');
const path = require('path');

async function createRealMCPExample() {
    // Example using a hypothetical file system MCP server
    // In practice, you would install and configure actual MCP servers
    const mcpServer = new MCPServerStdio({
        name: 'filesystem-server',
        command: 'node',
        args: [path.join(__dirname, '../mcp-servers/filesystem-server.js')],
        cacheToolsList: true,
        env: {
            ...process.env,
            MCP_SERVER_ROOT: process.cwd()
        }
    });

    try {
        console.log('Connecting to real MCP server...');
        await mcpServer.connect();
        
        console.log('Loading tools from MCP server...');
        const mcpTools = await getAllMcpTools([mcpServer]);
        
        console.log(`Loaded ${mcpTools.length} tools:`, mcpTools.map(t => t.name));
        
        // Create agent with MCP tools
        const agent = new Agent({
            name: 'File System Assistant',
            instructions: `You are a helpful assistant with access to file system operations via MCP tools.
            
You can help users with:
- Reading file contents
- Listing directory contents  
- Creating and writing files
- Searching for files
- Getting file information

Always be helpful and explain what you're doing when using tools.`,
            tools: mcpTools
        });

        return { agent, mcpServer };
        
    } catch (error) {
        console.log('Real MCP server not available, falling back to mock...');
        await mcpServer.close().catch(() => {});
        throw error;
    }
}

async function createMockMCPExample() {
    // Fallback mock implementation for when real MCP server isn't available
    const mockTools = [
        {
            name: 'read_file',
            description: 'Read the contents of a file',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the file to read'
                    }
                },
                required: ['path'],
                additionalProperties: false
            },
            func: async ({ path }) => {
                return `Mock content of file: ${path}\n\nThis is simulated file content for demonstration purposes.`;
            }
        },
        {
            name: 'list_directory',
            description: 'List contents of a directory',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Directory path to list'
                    }
                },
                required: ['path'],
                additionalProperties: false
            },
            func: async ({ path }) => {
                return `Directory listing for ${path}:\n- file1.txt\n- file2.js\n- subdirectory/\n- README.md`;
            }
        },
        {
            name: 'write_file',
            description: 'Write content to a file',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path where to write the file'
                    },
                    content: {
                        type: 'string',
                        description: 'Content to write to the file'
                    }
                },
                required: ['path', 'content'],
                additionalProperties: false
            },
            func: async ({ path, content }) => {
                return `Successfully wrote ${content.length} characters to ${path}`;
            }
        }
    ];

    const agent = new Agent({
        name: 'Mock File System Assistant',
        instructions: `You are a helpful assistant with access to file system operations (simulated).
        
You can help users with:
- Reading file contents (read_file)
- Listing directory contents (list_directory)
- Writing files (write_file)

Note: This is a demonstration using mock tools that simulate file operations.`,
        tools: mockTools
    });

    return { agent, mcpServer: null };
}

async function main() {
    let agent, mcpServer;
    
    try {
        // Try to use real MCP server first
        ({ agent, mcpServer } = await createRealMCPExample());
        console.log('✅ Using real MCP server');
    } catch (error) {
        // Fall back to mock if real server not available
        ({ agent, mcpServer } = await createMockMCPExample());
        console.log('⚠️  Using mock MCP tools (real server not available)');
    }

    try {
        console.log('\n--- Testing File Operations ---');
        
        // Test reading a file
        console.log('\n📖 Testing file reading...');
        const readResult = await run(
            agent,
            'Can you read the contents of package.json file?'
        );
        console.log('Read result:', readResult.finalOutput);
        
        // Test listing directory
        console.log('\n📁 Testing directory listing...');
        const listResult = await run(
            agent,
            'Please list the contents of the current directory'
        );
        console.log('List result:', listResult.finalOutput);
        
        // Test writing a file
        console.log('\n✏️  Testing file writing...');
        const writeResult = await run(
            agent,
            'Create a new file called "test.txt" with the content "Hello from MCP agent!"'
        );
        console.log('Write result:', writeResult.finalOutput);
        
        // Test complex operation
        console.log('\n🔄 Testing complex operation...');
        const complexResult = await run(
            agent,
            'List the current directory, then read the README.md file if it exists'
        );
        console.log('Complex result:', complexResult.finalOutput);
        
    } catch (error) {
        console.error('Error during agent execution:', error);
    } finally {
        // Clean up
        if (mcpServer) {
            await mcpServer.close();
        }
    }
}

// Run the example
main().catch(console.error);

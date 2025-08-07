const { setupMonocle } = require("../../dist");
setupMonocle("mcp");

const fetch = require('node-fetch');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const cors = require('cors');

// Configuration
const SERVER_PORT = 3000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

const getServer = () => {
    const server = new McpServer({
        name: 'json-response-streamable-http-server',
        version: '1.0.0',
    }, {
        capabilities: {
            logging: {},
        }
    });
    
    // Register a simple tool that returns a greeting
    server.tool('greet', 'A simple greeting tool', {
        name: z.string().describe('Name to greet'),
    }, async ({ name }) => {
        return {
            content: [
                {
                    type: 'text',
                    text: `Hello, ${name}!`,
                },
            ],
        };
    });
    
    return server;
};

class McpServerTester {
    constructor() {
        this.server = null;
        this.sessionId = null;
        this.transports = {};
    }

    async startServer() {
        console.log('🚀 Starting MCP server...');
        
        const app = express();
        app.use(express.json());
        app.use(cors({
            origin: '*',
            exposedHeaders: ['Mcp-Session-Id']
        }));

        // POST endpoint for MCP requests
        app.post('/mcp', async (req, res) => {
            console.log('Received MCP request:', req.body);
            try {
                // Check for existing session ID
                const sessionId = req.headers['mcp-session-id'];
                let transport;
                
                if (sessionId && this.transports[sessionId]) {
                    // Reuse existing transport
                    transport = this.transports[sessionId];
                }
                else if (!sessionId && isInitializeRequest(req.body)) {
                    // New initialization request - use JSON response mode
                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        enableJsonResponse: true,
                        onsessioninitialized: (sessionId) => {
                            console.log(`Session initialized with ID: ${sessionId}`);
                            this.transports[sessionId] = transport;
                        }
                    });
                    
                    // Connect the transport to the MCP server
                    const server = getServer();
                    await server.connect(transport);
                    await transport.handleRequest(req, res, req.body);
                    return;
                }
                else {
                    // Invalid request
                    res.status(400).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32000,
                            message: 'Bad Request: No valid session ID provided',
                        },
                        id: null,
                    });
                    return;
                }
                
                // Handle the request with existing transport
                await transport.handleRequest(req, res, req.body);
            }
            catch (error) {
                console.error('Error handling MCP request:', error);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Internal server error',
                        },
                        id: null,
                    });
                }
            }
        });

        // GET endpoint
        app.get('/mcp', async (req, res) => {
            console.log('Received MCP GET request');
            res.status(405).set('Allow', 'POST').send('Method Not Allowed');
        });

        // Start the server
        return new Promise((resolve, reject) => {
            this.server = app.listen(SERVER_PORT, (error) => {
                if (error) {
                    console.error('Failed to start server:', error);
                    reject(error);
                } else {
                    console.log(`MCP Streamable HTTP Server listening on port ${SERVER_PORT}`);
                    console.log('✅ Server started successfully');
                    resolve();
                }
            });
        });
    }

    async stopServer() {
        if (this.server) {
            console.log('🛑 Stopping MCP server...');
            
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('✅ Server stopped');
                    resolve();
                });
            });
        }
    }

    async testGetRequest() {
        console.log('\n📞 Testing GET request...');
        
        try {
            const response = await fetch(`${SERVER_URL}/mcp`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json, text/event-stream'
                }
            });

            console.log(`GET Response Status: ${response.status}`);
            console.log(`GET Response Headers:`, Object.fromEntries(response.headers.entries()));
            
            const responseText = await response.text();
            console.log(`GET Response Body: ${responseText}`);
            
            if (response.status === 405) {
                console.log('✅ GET request correctly returned 405 Method Not Allowed');
                return true;
            } else {
                console.log('❌ GET request did not return expected 405 status');
                return false;
            }
        } catch (error) {
            console.error('❌ GET request failed:', error.message);
            return false;
        }
    }

    async testInitializeRequest() {
        console.log('\n📞 Testing POST initialize request...');
        
        try {
            const initRequest = {
                jsonrpc: "2.0",
                method: "initialize",
                params: {
                    clientInfo: {
                        name: "test-client",
                        version: "1.0.0"
                    },
                    protocolVersion: "2024-11-05",
                    capabilities: {}
                },
                id: "init-1"
            };

            const response = await fetch(`${SERVER_URL}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream'
                },
                body: JSON.stringify(initRequest)
            });

            console.log(`Initialize Response Status: ${response.status}`);
            console.log(`Initialize Response Headers:`, Object.fromEntries(response.headers.entries()));
            
            // Extract session ID from headers
            this.sessionId = response.headers.get('mcp-session-id');
            console.log(`Session ID: ${this.sessionId}`);
            
            const responseData = await response.json();
            console.log('Initialize Response Body:', JSON.stringify(responseData, null, 2));
            
            if (response.status === 200 && this.sessionId) {
                console.log('✅ Initialize request successful');
                return true;
            } else {
                console.log('❌ Initialize request failed');
                return false;
            }
        } catch (error) {
            console.error('❌ Initialize request failed:', error.message);
            return false;
        }
    }

    async testToolCall() {
        if (!this.sessionId) {
            console.log('❌ Cannot test tool call without session ID');
            return false;
        }

        console.log('\n📞 Testing tool call request...');
        
        try {
            const toolRequest = {
                jsonrpc: "2.0",
                method: "tools/call",
                params: {
                    name: "greet",
                    arguments: {
                        name: "World"
                    }
                },
                id: "call-1"
            };

            const response = await fetch(`${SERVER_URL}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'Mcp-Session-Id': this.sessionId
                },
                body: JSON.stringify(toolRequest)
            });

            console.log(`Tool Call Response Status: ${response.status}`);
            console.log(`Tool Call Response Headers:`, Object.fromEntries(response.headers.entries()));
            
            const responseData = await response.json();
            console.log('Tool Call Response Body:', JSON.stringify(responseData, null, 2));
            
            if (response.status === 200 && responseData.result && responseData.result.content) {
                console.log('✅ Tool call successful');
                return true;
            } else {
                console.log('❌ Tool call failed');
                return false;
            }
        } catch (error) {
            console.error('❌ Tool call failed:', error.message);
            return false;
        }
    }

    async testInvalidRequest() {
        console.log('\n📞 Testing invalid request (no session ID)...');
        
        try {
            const invalidRequest = {
                jsonrpc: "2.0",
                method: "tools/call",
                params: {
                    name: "greet",
                    arguments: {
                        name: "World"
                    }
                },
                id: "call-invalid"
            };

            const response = await fetch(`${SERVER_URL}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream'
                },
                body: JSON.stringify(invalidRequest)
            });

            console.log(`Invalid Request Response Status: ${response.status}`);
            
            const responseData = await response.json();
            console.log('Invalid Request Response Body:', JSON.stringify(responseData, null, 2));
            
            if (response.status === 400 && responseData.error) {
                console.log('✅ Invalid request correctly returned 400 error');
                return true;
            } else {
                console.log('❌ Invalid request did not return expected 400 error');
                return false;
            }
        } catch (error) {
            console.error('❌ Invalid request test failed:', error.message);
            return false;
        }
    }

    async runAllTests() {
        console.log('🧪 Starting MCP Server Test\n');

        try {
            // Start server
            await this.startServer();
            // Wait a moment for server to be ready
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // // Test initialize
            await this.testInitializeRequest();
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Test tool call
            await this.testToolCall();
            await new Promise(resolve => setTimeout(resolve, 5000));
            
        } catch (error) {
            console.error('❌ Test suite error:', error.message);
        } finally {
            await this.stopServer();
        }
        process.exit(1);
    }
}

// Run the tests
const tester = new McpServerTester();
tester.runAllTests().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});

// Handle cleanup on exit
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, cleaning up...');
    const tester = new McpServerTester();
    await tester.stopServer();
    process.exit(1);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, cleaning up...');
    const tester = new McpServerTester();
    await tester.stopServer();
    process.exit(1);
});

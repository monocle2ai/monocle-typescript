// const { setupMonocle } = require("../../dist");
// setupMonocle("mcp");

const fetch = require('node-fetch');
const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const cors = require('cors');

const SERVER_PORT = 3000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

const getServer = () => {
    const server = new McpServer({
        name: 'json-response-streamable-http-server',
        version: '1.0.0',
        enableJsonResponse: true
    }, {
        capabilities: {
            logging: {},
        }
    });

    server.tool('calculate', 'A simple maths calculation tool', {
        expression: z.string().describe('Math expression to evaluate, e.g. "2 + 2"'),
    }, async ({ expression }) => {
        let result;
        try {
            if (/^[0-9+\-*/ ().]+$/.test(expression)) {
                result = eval(expression);
            } else {
                throw new Error('Invalid expression');
            }
        } catch (e) {
            result = `Error: ${e.message}`;
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `Result: ${result}`,
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
        const app = express();
        app.use(express.json());
        app.use(cors({
            origin: '*',
            exposedHeaders: ['Mcp-Session-Id']
        }));

        app.post('/mcp', async (req, res) => {
            try {
                const transport = new StreamableHTTPServerTransport({
                    enableJsonResponse: true
                });
                const server = getServer();
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
            } catch (error) {
                console.error('Error handling MCP request:', error);
            }
        });

        // GET endpoint
        app.get('/mcp', async (req, res) => {
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
                    resolve();
                }
            });
        });
    }

    async stopServer() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('Server stopped');
                    resolve();
                });
            });
        }
    }

    async testGetRequest() {
        try {
            const response = await fetch(`${SERVER_URL}/mcp`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json, text/event-stream'
                }
            });

            if (response.status === 405) {
                return true;
            } else {
                return false;
            }
        } catch (error) {
            return false;
        }
    }


    async testToolCall() {

        try {
            const toolRequest = {
                jsonrpc: "2.0",
                method: "tools/call",
                params: {
                    name: "calculate",
                    arguments: {
                        expression: "4 + 4"
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

            const responseData = await response.json();

            if (response.status === 200 && responseData.result && responseData.result.content) {
                return true;
            } else {
                return false;
            }
        } catch (error) {
            return false;
        }
    }

    async runAllTests() {
        console.log('🧪 Starting MCP Server Test\n');
        try {
            await this.startServer();
            await new Promise(resolve => setTimeout(resolve, 5000));

            await this.testToolCall();
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            console.error('Test suite error:', error.message);
        } finally {
            await this.stopServer();
        }
    }
}




if (require.main === module) {
    // Run the tests
    const tester = new McpServerTester();
    tester.runAllTests().catch(error => {
        console.error(' Fatal error:', error);
        process.exit(1);
    });
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, cleaning up...');
    const tester = new McpServerTester();
    await tester.stopServer();
    process.exit(1);
});

process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, cleaning up...');
    const tester = new McpServerTester();
    await tester.stopServer();
    process.exit(1);
});

module.exports = { McpServerTester };
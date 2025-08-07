import { getExceptionMessage } from "../../utils";

export const config = {
    "type": "agentic.mcp.invocation",
    "attributes": [
        [
            {
                "attribute": "type",
                "accessor": function ({ instance, args }) {
                    
                    // For handleRequest method: args[2] contains the JSON-RPC request
                    if (args && args.length >= 3 && args[2]) {
                        const request = args[2];
                        // Check if this is a tools/call request and extract the tool name
                        if (request.method === "tools/call" && request.params && request.params.name) {
                            return request.params.name;
                        }
                    }
                    
                    // For send method: args[0] contains the JSON-RPC message
                    if (args && args.length >= 1 && args[0]) {
                        const message = args[0];
                        // Check if this is a tools/call request and extract the tool name
                        if (message.method === "tools/call" && message.params && message.params.name) {
                            return message.params.name;
                        }
                    }
                    
                    // Fallback to instance name or default
                    if (instance?.constructor?.name) {
                        return instance?.constructor?.name;
                    }
                    return "mcp_server";
                }
            },
            {
                "_comment": "tool type",
                "attribute": "tool",
                "accessor": function () {
                    return "mcp.server";
                }
            },
            {   
                "_comment": "tool url",
                "attribute": "url",
                "accessor": function ({ args }) {

                    if (args && args[0] && typeof args[0] === 'object') {
                        const req = args[0];
                        
                        // Check if it's an IncomingMessage (HTTP request)
                        if (req.headers && req.socket && req.method) {
                            try {
                                // Get protocol - check if connection is encrypted
                                const protocol = req.socket.encrypted || req.socket._securePending ? 'https' : 'http';
                                
                                // Get host from headers (try multiple header variations)
                                const host = req.headers.host || 
                                            req.headers[':authority'] || 
                                            req.headers['x-forwarded-host'] ||
                                            'localhost';
                                
                                // Construct the full baseURL
                                const baseUrl = `${protocol}://${host}`;
                                
                                // If there's a specific path, include it
                                if (req.url && req.url !== '/') {
                                    return `${baseUrl}${req.url}`;
                                }
                                
                                return baseUrl;
                            } catch (e) {
                                console.warn('Error extracting baseURL from request:', e);
                            }
                        }
                    }
        
                    return "";
                }
            }
        ]
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [

                {
                    "_comment": "MCP request input",
                    "attribute": "input",
                    "accessor": function ({ args }: any): any {
                        try {
                            // For handleRequest method: args[2] contains the JSON-RPC request
                            if (args && args.length >= 3 && args[2]) {
                                return JSON.stringify(args[2]);
                            }
                            
                            // For send method: args[0] contains the JSON-RPC message
                            if (args && args.length >= 1 && args[0]) {
                                // Check if first arg is the JSON-RPC request/response
                                if (args[0].jsonrpc || args[0].method || args[0].id) {
                                    return JSON.stringify(args[0]);
                                }
                            }
                            
                            // Fallback to first argument or all arguments
                            return JSON.stringify(args[0]) || JSON.stringify(args);
                        } catch (e) {
                            console.warn(`Warning: Error extracting MCP input: ${e}`);
                            return JSON.stringify(args);
                        }
                    }
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "MCP response output",
                    "attribute": "response",
                    "accessor": function ({ response, exception, args }) {
                        if (exception) {
                            return getExceptionMessage({ exception });
                        }
                        
                        try {
                            // For send method, the first argument should be the JSON-RPC message
                            if (args && args.length >= 1 && args[0]) {
                                const message = args[0];
                                
                                // Check if this is a JSON-RPC response message
                                if (message && (message.result !== undefined || message.error !== undefined)) {
                                    return JSON.stringify(message);
                                }
                                
                                // Check if it's a JSON-RPC message with method/params (request)
                                if (message && message.method) {
                                    return JSON.stringify(message);
                                }
                            }
                            
                            return ""
                        } catch (e) {
                            console.warn(`Warning: Error occurred in MCP output extraction: ${e}`);
                            if (response) {
                                try {
                                    return JSON.stringify(response);
                                } catch (stringifyError) {
                                    return String(response);
                                }
                            }
                            return null;
                        }
                    }
                }
            ]
        }
    ]
}


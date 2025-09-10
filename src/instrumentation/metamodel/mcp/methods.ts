import { config as toolConfig } from "./entities/tools";

export const config = [
  // HTTP transport instrumentation
  // {
  //   package: "@modelcontextprotocol/sdk/server/streamableHttp.js",
  //   object: "StreamableHTTPServerTransport",
  //   method: "handleRequest",
  //   spanName: "mcp.handle_request",
  //   output_processor: [toolConfig],
  // },
  // HTTP transport send method instrumentation
  // {
  //   package: "@modelcontextprotocol/sdk/server/streamableHttp.js",
  //   object: "StreamableHTTPServerTransport",
  //   method: "send",
  //   spanName: "mcp.send_response",
  //   output_processor: [toolConfig],
  // },
  {
    package: "@modelcontextprotocol/sdk/client/index.js",
    object: "Client",
    method: "callTool",
    spanName: "mcp.call_tool",
    output_processor: [toolConfig],
  }
];
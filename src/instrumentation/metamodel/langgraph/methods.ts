import { AGENT as agentConfig } from "./entities/inference";
import { TOOLS as toolConfig } from "./entities/inference";
import { LangGraphAgentSpanHandler, LangGraphToolSpanHandler } from "./langgraphProcessor";

export const config = [
  {
    "package": "@langchain/langgraph",
    "object": "CompiledStateGraph",
    "method": "invoke",
    "spanName": "langgraph.agent.invoke",
    "spanHandler": new LangGraphAgentSpanHandler(),
    "output_processor": [agentConfig],
  },
  {
    "package": "@langchain/core/tools",
    "object": "StructuredTool",
    "method": "invoke",
    "spanName": "langchain.tool",
    "spanHandler": new LangGraphToolSpanHandler(),
    "output_processor": [
      toolConfig
    ]
  }
];
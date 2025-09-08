import { AGENT_REQUEST, TOOLS } from "./entities/inference";
// import { config as retrievalConfig } from "./entities/retrieval";

export const config = [
    {
        "package": "@openai/agents",
        "object": "Runner",
        "method": "run",
        "spanName": "openai.agent",
        // "span_handler": "agents_agent_handler",
        "output_processor": [AGENT_REQUEST],
    },
    
    // Instrument the tool() function to wrap tool creation and potentially their invoke methods
    {
        "package": "@openai/agents",
        "object": "",
        "method": "tool",
        "spanName": "openai.agent.invoke_tool",
        "output_processor": [TOOLS],
    },

    // {
    //     "package": "@openai/agents",
    //     "object": "FunctionTool",
    //     "method": "",
    //     "spanName": "openai.agent_tool",
    //     "output_processor": [TOOLS],
    // },

    // {
    //     "package": "@openai/agents",
    //     "object": "AgentRunner",
    //     "method": "_run_single_turn",
    //     // "span_handler": "agents_agent_handler",
    //     "output_processor": [AGENT],
    // },
    
    // Note: FunctionTool doesn't exist as a class. Tools are plain objects created by tool() function.
    // Tool invocations would need to be instrumented differently, possibly by wrapping the tool() function
    // or using custom span handlers at the agent level.
    
    // {
    //     "package": "@openai/agents",
    //     "object": "Handoff",
    //     "method": "onInvokeHandoff",
    //     "output_processor": [AGENT_DELEGATION],
    // },
];
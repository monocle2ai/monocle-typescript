import { AgentsSpanHandler } from "./agentProcessors";
import { AGENT_DELEGATION, AGENT_REQUEST, TOOLS } from "./entities/inference";

export const config = [
    {
        "package": "@openai/agents",
        "object": "Runner",
        "method": "run",
        "spanName": "openai.Runner",
        "spanHandler": new AgentsSpanHandler(),
        "output_processor": [AGENT_REQUEST],
    },
    {
        "package": "@openai/agents",
        "object": "",
        "method": "tool",
        "spanName": "openai.tool",
        "spanHandler": new AgentsSpanHandler(),
        "output_processor": [TOOLS],
    },
    {
        "package": "@openai/agents",
        "object": "",
        "method": "handoff",
        "spanName": "openai.handoff",
        "output_processor": [AGENT_DELEGATION],
    },
];
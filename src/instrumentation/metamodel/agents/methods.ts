import {
    AgentsSpanHandler,
    toolConstructorWrapper,
    handoffConstructorWrapper,
} from "./agentProcessors";
import { AGENT, AGENT_DELEGATION, AGENT_REQUEST, TOOLS } from "./entities/inference";

export const config = [
    {
        "package": "@openai/agents",
        "object": "Runner",
        "method": "run",
        "spanName": "openai.Runner.run",
        "spanHandler": new AgentsSpanHandler(),
        "output_processor": [AGENT_REQUEST],
    },
    {
        "package": "@openai/agents",
        "object": "",
        "method": "run",
        "spanName": "openai.run",
        "spanHandler": new AgentsSpanHandler(),
        "output_processor": [AGENT],
    },
    {
        "package": "@openai/agents",
        "object": "",
        "method": "tool",
        "wrapperMethod": toolConstructorWrapper,
        "spanName": "openai.tool",
        "output_processor": [TOOLS],
    },
    {
        "package": "@openai/agents",
        "object": "",
        "method": "handoff",
        "wrapperMethod": handoffConstructorWrapper,
        "spanName": "openai.handoff",
        "output_processor": [AGENT_DELEGATION],
    }
];
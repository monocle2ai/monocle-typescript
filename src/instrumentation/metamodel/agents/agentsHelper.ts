// Shared accessors for the @openai/agents metamodel.

// Entity type carried by every agents-SDK span.
export const AGENTS_AGENT_TYPE = "agent.openai_agents";

// Runner.run(agent, input, options?): input is a string or AgentInputItem[].
export function extractRunInput(args: any): string {
    const input = args?.[1];
    if (input === undefined || input === null) {
        return "";
    }
    return typeof input === "string" ? input : safeStringify(input);
}

// RunResult and StreamedRunResult both expose finalOutput.
export function extractRunOutput(response: any): string {
    const output = response?.finalOutput;
    if (output === undefined || output === null) {
        return "";
    }
    return typeof output === "string" ? output : safeStringify(output);
}

// MCP and hosted tools are tools too, so read the kind off the object rather
// than assuming a function tool.
export function toolTypeOf(tool: any): string {
    const type = tool?.type;
    if (type === "hosted_tool" || type === "hosted_mcp") {
        return "tool.mcp";
    }
    if (tool?.mcpServer || tool?.serverLabel) {
        return "tool.mcp";
    }
    return "tool.openai_agents";
}

// Agent payloads can carry cycles (RunContext back-references) or throwing
// getters; serialization must never break a span.
export function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? "";
    } catch {
        return "";
    }
}

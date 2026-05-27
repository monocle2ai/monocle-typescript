const { setupMonocle } = require("../../dist");
setupMonocle("adk.smoke.agent");

const { LlmAgent } = require("@google/adk");

async function main() {
    const agent = new LlmAgent({
        name: "adk_smoke_agent",
        model: "gemini-2.5-flash-lite",
        description: "smoke test agent",
        instruction: "do nothing",
    });

    // Stub the underlying impl so we don't hit the network.
    agent.runAsyncImpl = async function* () {
        yield {
            invocationId: "inv-1",
            author: "adk_smoke_agent",
            content: { role: "model", parts: [{ text: "hello from stub" }] },
            actions: {},
        };
    };

    const fakeParentContext = {
        invocationId: "inv-1",
        agent,
        session: {
            events: [
                {
                    author: "user",
                    content: { role: "user", parts: [{ text: "Book me a flight" }] },
                },
            ],
        },
        endInvocation: false,
    };

    const collected = [];
    for await (const ev of agent.runAsync(fakeParentContext)) {
        collected.push(ev);
    }
    return collected;
}

module.exports = { main };

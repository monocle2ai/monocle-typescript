// Exercises nested AsyncGenerator wrapping: Runner.runEphemeral internally
// calls Runner.runAsync which iterates BaseAgent.runAsync. All four wrapped
// generators (workflow + 3 nested) must share the same trace_id and form a
// parent_id chain.
const { setupMonocle } = require("../../dist");
setupMonocle("adk.nested.sample");

const { LlmAgent, InMemoryRunner } = require("@google/adk");

async function main() {
    const agent = new LlmAgent({
        name: "adk_nested_agent",
        model: "gemini-2.5-flash-lite",
        description: "nested smoke test",
        instruction: "do nothing",
    });

    // Stub the model loop so we don't hit the network.
    agent.runAsyncImpl = async function* () {
        yield {
            invocationId: "inv-1",
            author: "adk_nested_agent",
            content: { role: "model", parts: [{ text: "ok" }] },
            actions: {},
        };
    };

    const runner = new InMemoryRunner({ agent, appName: "adk.nested.sample" });

    const events = [];
    for await (const ev of runner.runEphemeral({
        userId: "user_123",
        newMessage: { role: "user", parts: [{ text: "Hello" }] },
    })) {
        events.push(ev);
    }
    return events;
}

module.exports = { main };

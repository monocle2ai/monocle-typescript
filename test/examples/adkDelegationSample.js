// Drives two real `BaseAgent.runAsync` wrappers in sequence (supervisor →
// sub-agent) by having the supervisor's stubbed runAsyncImpl directly invoke
// the sub-agent's wrapped runAsync. This bypasses LLM + AgentTool plumbing
// while still exercising the actual ADK code paths that establish the
// delegator context on `BaseAgent.runAsync`. The sub-agent span should carry
// `entity.1.from_agent` (= supervisor's name) and `entity.1.from_agent_span_id`
// (= supervisor's span_id) per the new context-key delegation tracker.
const { setupMonocle } = require("../../dist");
setupMonocle("adk.delegation.sample");

const { LlmAgent } = require("@google/adk");

async function main() {
    const subAgent = new LlmAgent({
        name: "adk_sub_agent",
        model: "gemini-2.5-flash-lite",
        description: "delegated sub-agent",
        instruction: "n/a",
    });
    subAgent.runAsyncImpl = async function* (invocationContext) {
        yield {
            invocationId: invocationContext.invocationId || "inv-sub",
            author: "adk_sub_agent",
            content: { role: "model", parts: [{ text: "sub result" }] },
            actions: {},
        };
    };

    const supervisor = new LlmAgent({
        name: "adk_supervisor_agent",
        model: "gemini-2.5-flash-lite",
        description: "supervisor that delegates",
        instruction: "n/a",
    });
    supervisor.runAsyncImpl = async function* (invocationContext) {
        // Drive the sub-agent's wrapped runAsync directly. The InvocationContext
        // ADK passes here carries `agent: supervisor`, so when we hand it to
        // sub.runAsync the parentContext.agent will be supervisor — but our
        // delegator tracker doesn't look at args, it reads the previous
        // ADK_AGENT_NAME_KEY (set by supervisor's preTracing). That's the
        // path being exercised.
        for await (const ev of subAgent.runAsync(invocationContext)) {
            yield ev;
        }
        yield {
            invocationId: invocationContext.invocationId || "inv-sup",
            author: "adk_supervisor_agent",
            content: { role: "model", parts: [{ text: "done" }] },
            actions: {},
        };
    };

    const fakeParentContext = {
        invocationId: "inv-1",
        agent: supervisor,
        session: { events: [] },
        endInvocation: false,
    };

    const events = [];
    for await (const ev of supervisor.runAsync(fakeParentContext)) {
        events.push(ev);
    }
    return events;
}

module.exports = { main };

// Reproduces the user's bug: a real ADK BaseAgent.runAsync (which itself
// creates a no-op `invoke_agent` span and binds it onto the OTel active-span
// slot for the inner generator) calls into another wrapped method. Without
// MONOCLE_ACTIVE_SPAN_KEY, the inner method picks the wrong parent and the
// trace fragments.
const { setupMonocle } = require("../../dist");
setupMonocle("adk.real.agent.sample");

const { LlmAgent, FunctionTool } = require("@google/adk");
const { z } = require("zod/v4");

async function main() {
    const bookFlightTool = new FunctionTool({
        name: "book_flight",
        description: "Books a flight.",
        parameters: z.object({ from: z.string(), to: z.string() }),
        execute: async ({ from, to }) => ({ message: `flight ${from}->${to} booked` }),
    });

    const agent = new LlmAgent({
        name: "real_agent",
        model: "gemini-2.5-flash-lite",
        description: "test agent",
        instruction: "n/a",
        tools: [bookFlightTool],
    });

    // Stub runAsyncImpl to call the wrapped tool from inside ADK's REAL
    // BaseAgent.runAsync (which we don't stub). ADK's runAsync creates a
    // no-op "invoke_agent <name>" span and binds it as the active OTel span
    // for runAsyncImpl. The tool wrapper must still pick our agent.run span
    // as its parent — which only works if we read from MONOCLE_ACTIVE_SPAN_KEY
    // instead of the OTel active-span slot.
    agent.runAsyncImpl = async function* (invocationContext) {
        await bookFlightTool.runAsync({
            args: { from: "SFO", to: "BOM" },
            toolContext: { invocationContext, actions: {} },
        });
        yield {
            invocationId: invocationContext.invocationId || "inv-1",
            author: "real_agent",
            content: { role: "model", parts: [{ text: "ok" }] },
            actions: {},
        };
    };

    const fakeParentContext = {
        invocationId: "inv-1",
        agent,
        session: { events: [] },
        endInvocation: false,
    };

    const events = [];
    for await (const ev of agent.runAsync(fakeParentContext)) {
        events.push(ev);
    }
    return events;
}

module.exports = { main };

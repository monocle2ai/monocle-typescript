// Real model calls with a Monocle instruction in effect. Spans go to an
// in-memory exporter so the test can read them without waiting for a flush.
const path = require("path");
process.env.MONOCLE_INSTRUCTION = path.join(__dirname, "../data/start-with-123456.yaml");

const { setupMonocle } = require("../../dist");
const { InMemorySpanExporter, SimpleSpanProcessor } = require("@opentelemetry/sdk-trace-base");

const exporter = new InMemorySpanExporter();
setupMonocle("instruction.sample", [new SimpleSpanProcessor(exporter)]);

const SYSTEM_PROMPT = "You are a helpful travel agent. Answer in one sentence.";

async function askOpenAI(question) {
    const OpenAI = require("openai").default;
    const client = new OpenAI();
    const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: question },
        ],
    });
    return response.choices[0].message.content;
}

async function askAdkAgent(question) {
    const { LlmAgent, InMemoryRunner, isFinalResponse, stringifyContent } = require("@google/adk");
    const agent = new LlmAgent({
        name: "travel_agent",
        model: "gemini-2.5-flash",
        description: "Answers travel questions.",
        instruction: SYSTEM_PROMPT,
    });
    const runner = new InMemoryRunner({ agent, appName: "instruction_sample" });
    let answer = "";
    for await (const event of runner.runEphemeral({
        userId: "user_1",
        newMessage: { role: "user", parts: [{ text: question }] },
    })) {
        if (isFinalResponse(event)) {
            answer = stringifyContent(event) || answer;
        }
    }
    return answer;
}

module.exports = { exporter, askOpenAI, askAdkAgent };

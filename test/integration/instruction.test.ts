import { describe, it, expect, afterEach } from 'vitest';

// Live: the model is told to begin every response with 123456, so an answer
// that does shows the instruction reached it.
const sample = require('../examples/instructionSample.js');

const INSTRUCTION_NAME = 'start-with-123456';
const LABELLED = JSON.stringify({ instruction: 'Begin every response with 123456.' });
const QUESTION = 'What is a good month to visit Lisbon?';

const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
const hasGeminiKey = Boolean(process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY);

// Every inference span names the instruction and lists it first in its input.
function expectInferenceSpansCarryInstruction() {
    const inference = sample.exporter.getFinishedSpans()
        .filter((span: any) => span.attributes['span.type'] === 'inference');
    expect(inference.length).toBeGreaterThan(0);
    for (const span of inference) {
        expect(span.attributes['monocle.instruction']).toBe(INSTRUCTION_NAME);
        const input = span.events.find((event: any) => event.name === 'data.input')?.attributes?.input;
        expect(input[0]).toBe(LABELLED);
    }
}

describe('Monocle instruction reaches the model', () => {
    afterEach(() => sample.exporter.reset());

    it.skipIf(!hasOpenAIKey)('OpenAI chat completion', async () => {
        const answer = await sample.askOpenAI(QUESTION);

        expect(answer.trim().startsWith('123456')).toBe(true);
        expectInferenceSpansCarryInstruction();
    }, 60000);

    it.skipIf(!hasGeminiKey)('ADK agent on Gemini', async () => {
        const answer = await sample.askAdkAgent(QUESTION);

        expect(answer.trim().startsWith('123456')).toBe(true);
        expectInferenceSpansCarryInstruction();
    }, 60000);
});

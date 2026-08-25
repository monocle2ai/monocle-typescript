import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { context } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { getPatchedMain } from '../../src/instrumentation/common/wrapper';
import { config as mastraConfig } from '../../src/instrumentation/metamodel/mastra/methods';

// Integration test: drives the REAL monocle pipeline end to end — the actual
// wrapper (getPatchedMain), the real Mastra MethodConfig (span handler +
// output_processor), and OTel span emission via an in-memory exporter. Unlike
// the unit tests (which call schema accessors in isolation), this exercises the
// full path that turns a Mastra call's args/return into an exported span, so it
// catches emission-layer issues — e.g. the span handler choice, entity ordering,
// and non-primitive attribute values being dropped.
//
// It does NOT load @mastra/core (ESM, not a dep here) or import-in-the-middle;
// instead it feeds the wrapper realistic Mastra payloads (the exact runtime
// shapes observed from a live run: nested usage objects, { unified } finish
// reason) so the assertions reflect real data, not the (looser) type defs.

const exporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;
let tracer: any;

beforeAll(() => {
    context.setGlobalContextManager(new AsyncHooksContextManager().enable());
    provider = new NodeTracerProvider({
        resource: resourceFromAttributes({ SERVICE_NAME: 'mastra-integration-test' }),
        spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    tracer = provider.getTracer('mastra-integration-test');
});

afterAll(() => {
    context.disable();
});

beforeEach(() => {
    exporter.reset();
});

// Build a WrapperArguments from the real Mastra config entry + our test tracer.
function entryFor(method: string): any {
    const e = (mastraConfig as any[]).find((c) => c.method === method);
    if (!e) throw new Error(`no mastra config entry for method "${method}"`);
    return { ...e, tracer };
}

// Invoke the patched wrapper as if Mastra called the method: `this` = the
// instance, arguments = args, and the original resolves to `result`.
async function runWrapped(method: string, thisArg: any, args: any[], result: any): Promise<void> {
    const original = function () {
        return Promise.resolve(result);
    };
    const patched: any = getPatchedMain(entryFor(method))(original);
    await patched.apply(thisArg, args);
    // Let the deferred span-end (.then chains for workflow + child) flush.
    await new Promise((r) => setTimeout(r, 20));
}

function readableFrom(parts: any[]): ReadableStream {
    return new ReadableStream({
        start(c) { for (const p of parts) c.enqueue(p); c.close(); },
    });
}
async function drain(stream: ReadableStream): Promise<any[]> {
    const out: any[] = [];
    const reader = stream.getReader();
    while (true) { const { done, value } = await reader.read(); if (done) break; out.push(value); }
    return out;
}

// doStream resolves to { stream }; drain the wrapped stream so the span finalizes.
async function runStream(thisArg: any, args: any[], parts: any[]): Promise<any> {
    const original = function () {
        return Promise.resolve({ stream: readableFrom(parts) });
    };
    const patched: any = getPatchedMain(entryFor('doStream'))(original);
    const result: any = await patched.apply(thisArg, args);
    await drain(result.stream);
    await new Promise((r) => setTimeout(r, 20));
    return result;
}

function spanId(s: any): string {
    return s.spanContext().spanId;
}
function parentId(s: any): string | undefined {
    return s.parentSpanContext?.spanId ?? s.parentSpanId;
}
function eventsOf(s: any): Record<string, any> {
    return Object.fromEntries((s.events || []).map((e: any) => [e.name, e.attributes]));
}

describe('Mastra inference span (mastra.model.generate)', () => {
    // The exact shapes a live models.dev/openai-responses doGenerate returns:
    // nested usage objects and an object finishReason.
    const instance = { modelId: 'gpt-5-mini', provider: 'openai', gatewayId: 'models.dev' };
    const options = {
        prompt: [
            { role: 'system', content: 'You generate excuses.' },
            { role: 'user', content: [{ type: 'text', text: 'give me an excuse' }] },
        ],
    };
    const result = {
        content: [
            { type: 'reasoning', text: 'thinking...' },
            { type: 'text', text: 'My goldfish unionized.' },
        ],
        finishReason: { unified: 'stop' },
        usage: {
            inputTokens: { total: 137, cacheRead: 0 },
            outputTokens: { total: 663, text: 151, reasoning: 512 },
            raw: { input_tokens: 137, output_tokens: 663 },
        },
        stream: new ReadableStream({ start(c) { c.close(); } }),
    };

    it('emits an inference span with model, provider, input, output and token metadata', async () => {
        await runWrapped('doGenerate', instance, [options], result);

        const inf = exporter.getFinishedSpans().find((s) => s.name === 'mastra.model.generate');
        expect(inf, 'expected a mastra.model.generate span').toBeDefined();

        // Processed by DefaultSpanHandler (NOT skipped) → real inference span.
        expect(inf!.attributes['span.type']).toBe('inference');
        expect(inf!.attributes['span.subtype']).toBe('turn_end');

        // entity.1 = provider, entity.2 = model (schema group order).
        expect(inf!.attributes['entity.1.type']).toBe('inference.openai');
        expect(inf!.attributes['entity.1.inference_endpoint']).toBe('models.dev');
        expect(inf!.attributes['entity.2.type']).toBe('model.llm.gpt-5-mini');
        expect(inf!.attributes['entity.2.name']).toBe('gpt-5-mini');

        const ev = eventsOf(inf);
        expect(ev['data.input'].input).toContain(JSON.stringify({ system: 'You generate excuses.' }));
        expect(ev['data.input'].input).toContain(JSON.stringify({ user: 'give me an excuse' }));
        expect(ev['data.output'].response).toContain('goldfish unionized');

        // Regression guard: tokens must be emitted as PRIMITIVE numbers (pulled
        // out of the nested usage objects) — objects get dropped by OTel.
        expect(ev['metadata'].prompt_tokens).toBe(137);
        expect(ev['metadata'].completion_tokens).toBe(663);
        expect(ev['metadata'].total_tokens).toBe(800);
        expect(ev['metadata'].reasoning_tokens).toBe(512);
        expect(ev['metadata'].finish_reason).toBe('stop');
        expect(ev['metadata'].finish_type).toBe('stop');
    });

    it('classifies a tool-calls finish as a tool_call inference', async () => {
        const toolResult = {
            content: [{ type: 'tool-call', toolName: 'get_weather', input: '{"city":"NYC"}' }],
            finishReason: { unified: 'tool-calls' },
            usage: { inputTokens: { total: 10 }, outputTokens: { total: 4 } },
        };
        await runWrapped('doGenerate', instance, [options], toolResult);

        const inf = exporter.getFinishedSpans().find((s) => s.name === 'mastra.model.generate');
        expect(inf!.attributes['span.subtype']).toBe('tool_call');
        expect(eventsOf(inf)['data.output'].response).toContain('get_weather');
        expect(eventsOf(inf)['metadata'].finish_type).toBe('tool_call');
    });

    it('nests the inference span under an auto-created workflow.mastra root', async () => {
        await runWrapped('doGenerate', instance, [options], result);

        const spans = exporter.getFinishedSpans();
        const inf = spans.find((s) => s.name === 'mastra.model.generate');
        const workflow = spans.find((s) => s.name === 'workflow');
        expect(inf).toBeDefined();
        expect(workflow, 'expected an auto-created workflow root span').toBeDefined();
        expect(workflow!.attributes['entity.1.type']).toBe('workflow.mastra');
        expect(parentId(inf)).toBe(spanId(workflow));
        expect(parentId(workflow) == null).toBe(true);
        expect(inf!.spanContext().traceId).toBe(workflow!.spanContext().traceId);
    });
});

describe('Mastra turn span (mastra.agent.generate)', () => {
    it('emits an agentic.turn span nested under workflow.mastra with input/output', async () => {
        const instance = { id: 'excuse-agent', name: 'Excuse Agent' };
        const fullOutput = { text: 'My goldfish unionized.' };

        await runWrapped('generate', instance, ['give me an excuse'], fullOutput);

        const spans = exporter.getFinishedSpans();
        const turn = spans.find((s) => s.name === 'mastra.agent.generate');
        const workflow = spans.find((s) => s.name === 'workflow');
        expect(turn, 'expected a mastra.agent.generate turn span').toBeDefined();
        expect(workflow, 'expected a workflow root span').toBeDefined();

        expect(turn!.attributes['span.type']).toBe('agentic.turn');
        expect(turn!.attributes['span.subtype']).toBe('turn');
        expect(turn!.attributes['entity.1.type']).toBe('agent.mastra');
        expect(turn!.attributes['entity.1.name']).toBe('Excuse Agent');
        expect(workflow!.attributes['entity.1.type']).toBe('workflow.mastra');

        // Tokens are intentionally omitted from the turn span.
        expect(turn!.attributes['metadata']).toBeUndefined();

        // Parent chain: turn → workflow → root.
        expect(parentId(turn)).toBe(spanId(workflow));
        expect(parentId(workflow) == null).toBe(true);

        const ev = eventsOf(turn);
        expect(ev['data.input'].input).toContain(JSON.stringify({ user: 'give me an excuse' }));
        expect(ev['data.output'].response).toBe('My goldfish unionized.');
    });
});

describe('Mastra streaming inference span (mastra.model.stream)', () => {
    const instance = { modelId: 'gpt-5-mini', provider: 'openai', gatewayId: 'models.dev' };
    const options = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'say hi' }] }],
    };
    // Real LanguageModelV2 stream part shapes from a live doStream run.
    const parts = [
        { type: 'stream-start' },
        { type: 'text-start', id: 'm1' },
        { type: 'text-delta', id: 'm1', delta: 'My goldfish ' },
        { type: 'text-delta', id: 'm1', delta: 'unionized.' },
        { type: 'text-end', id: 'm1' },
        {
            type: 'finish',
            finishReason: { unified: 'stop' },
            usage: {
                inputTokens: { total: 128, cacheRead: 0 },
                outputTokens: { total: 993, text: 33, reasoning: 960 },
            },
        },
    ];

    it('emits an inference span with output/tokens accumulated from the stream', async () => {
        await runStream(instance, [options], parts);

        const inf = exporter.getFinishedSpans().find((s) => s.name === 'mastra.model.stream');
        expect(inf, 'expected a mastra.model.stream span').toBeDefined();
        expect(inf!.attributes['span.type']).toBe('inference');
        expect(inf!.attributes['span.subtype']).toBe('turn_end');
        expect(inf!.attributes['entity.1.type']).toBe('inference.openai');
        expect(inf!.attributes['entity.2.type']).toBe('model.llm.gpt-5-mini');

        const ev = eventsOf(inf);
        expect(ev['data.input'].input).toContain(JSON.stringify({ user: 'say hi' }));
        // Output accumulated from the text-delta parts:
        expect(ev['data.output'].response).toBe('My goldfish unionized.');
        // Tokens pulled from the finish part's nested usage:
        expect(ev['metadata'].prompt_tokens).toBe(128);
        expect(ev['metadata'].completion_tokens).toBe(993);
        expect(ev['metadata'].total_tokens).toBe(1121);
        expect(ev['metadata'].reasoning_tokens).toBe(960);
        expect(ev['metadata'].finish_reason).toBe('stop');
    });

    it('delivers every stream part unchanged to the consumer (non-destructive)', async () => {
        await runStream(instance, [options], parts);
        // Re-drive a fresh run to capture and assert the pass-through part order.
        const original = function () { return Promise.resolve({ stream: readableFrom(parts) }); };
        const patched: any = getPatchedMain(entryFor('doStream'))(original);
        const r2: any = await patched.apply(instance, [options]);
        const seen = await drain(r2.stream);
        expect(seen.map((p: any) => p.type)).toEqual(parts.map((p) => p.type));
        expect(seen[2].delta).toBe('My goldfish ');
    });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { context, ROOT_CONTEXT } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { AGENT_REQUEST } from '../../src/instrumentation/metamodel/mastra/entities/agentRequest';
import { SPAN_SUBTYPES } from '../../src/instrumentation/common/constants';
import { MastraTurnSpanHandler } from '../../src/instrumentation/metamodel/mastra/mastraProcessor';
import { MASTRA_TURN_SPAN_ACTIVE_KEY } from '../../src/instrumentation/common/constants';
import { getScopeFromContext } from '../../src/instrumentation/common/utils';
import { config as mastraConfig } from '../../src/instrumentation/metamodel/mastra/methods';
import { TOOL } from '../../src/instrumentation/metamodel/mastra/entities/tool';
import { AGENT_INVOCATION } from '../../src/instrumentation/metamodel/mastra/entities/agentInvocation';
import { MastraInvocationSpanHandler } from '../../src/instrumentation/metamodel/mastra/mastraProcessor';
import { FROM_AGENT_KEY, FROM_AGENT_SPAN_ID_KEY, MASTRA_AGENT_NAME_KEY } from '../../src/instrumentation/common/constants';
import { mastraToolWrapper } from '../../src/instrumentation/metamodel/mastra/mastraProcessor';
import { getPatchedMainList } from '../../src/instrumentation/common/wrapper';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';
import { INFERENCE, INFERENCE_STREAM } from '../../src/instrumentation/metamodel/mastra/entities/inference';
import { SPAN_TYPES, INFERENCE_TOOL_CALL, INFERENCE_TURN_END } from '../../src/instrumentation/common/constants';

function attrAccessor(schema: any, attribute: string, group = 0): Function {
    const found = schema.attributes[group].find((a: any) => a.attribute === attribute);
    if (!found) throw new Error(`no accessor for attribute "${attribute}"`);
    return found.accessor;
}
function eventAccessor(schema: any, eventName: string, attribute: string): Function {
    const ev = schema.events.find((e: any) => e.name === eventName);
    if (!ev) throw new Error(`no event "${eventName}"`);
    const found = ev.attributes.find((a: any) => a.attribute === attribute);
    if (!found) throw new Error(`no event attribute "${attribute}" on "${eventName}"`);
    return found.accessor;
}

describe('Mastra AGENT_REQUEST schema', () => {
    it('declares the agentic.turn type and turn subtype', () => {
        expect(AGENT_REQUEST.type).toBe('agentic.turn');
        expect(AGENT_REQUEST.subtype).toBe(SPAN_SUBTYPES.TURN);
    });

    it('type accessor returns the Mastra agent type', () => {
        expect(attrAccessor(AGENT_REQUEST, 'type')({})).toBe('agent.mastra');
    });

    describe('name accessor', () => {
        const name = (instance: any) => attrAccessor(AGENT_REQUEST, 'name')({ instance });
        it('prefers instance.name', () => {
            expect(name({ name: 'Weather Agent' })).toBe('Weather Agent');
        });
        it('falls back to instance.id then constructor name', () => {
            expect(name({ id: 'weather-agent' })).toBe('weather-agent');
            class Agent {}
            expect(name(new Agent())).toBe('Agent');
        });
        it('returns "" with no instance', () => {
            expect(name(null)).toBe('');
        });
    });

    describe('data.input accessor', () => {
        const input = (args: any[]) => eventAccessor(AGENT_REQUEST, 'data.input', 'input')({ args });
        it('handles a plain string message', () => {
            expect(input(['what is the weather?'])).toEqual([JSON.stringify({ user: 'what is the weather?' })]);
        });
        it('handles an array of role/content messages', () => {
            expect(input([[{ role: 'user', content: 'hi there' }]]))
                .toEqual([JSON.stringify({ user: 'hi there' })]);
        });
        it('handles content given as an array of text parts', () => {
            expect(input([[{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }]]))
                .toEqual([JSON.stringify({ user: 'a b' })]);
        });
        it('handles AI SDK UI messages with a parts array (useChat / playground)', () => {
            expect(input([[{ role: 'user', parts: [{ type: 'text', text: 'weather in Paris?' }] }]]))
                .toEqual([JSON.stringify({ user: 'weather in Paris?' })]);
        });
        it('handles a Mastra message signal (contents + type, single object)', () => {
            // Shape the Studio playground passes: a single signal object, text on
            // `contents`, role on `type`.
            expect(input([{ contents: 'weather in paris', type: 'user', tagName: 'user', __isCreatedSignal: true }]))
                .toEqual([JSON.stringify({ user: 'weather in paris' })]);
        });
        it('returns [] for empty/absent input', () => {
            expect(input([])).toEqual([]);
            expect(input([null])).toEqual([]);
        });
    });

    describe('data.output accessor', () => {
        const output = (bag: any) => eventAccessor(AGENT_REQUEST, 'data.output', 'response')(bag);
        it('returns the final text from a FullOutput-like response', () => {
            expect(output({ response: { text: 'It is sunny.' } })).toBe('It is sunny.');
        });
        it('returns "" when there is no text', () => {
            expect(output({ response: {} })).toBe('');
            expect(output({ response: null })).toBe('');
        });
        it('returns the exception message when the turn errored', () => {
            expect(output({ exception: new Error('boom') })).toContain('boom');
        });
    });
});

describe('MastraTurnSpanHandler', () => {
    const handler = new MastraTurnSpanHandler();

    beforeAll(() => { context.setGlobalContextManager(new AsyncHooksContextManager().enable()); });
    afterAll(() => { context.disable(); });

    it('skipSpan is false at the top level and true once the turn key is set', () => {
        context.with(ROOT_CONTEXT, () => { expect(handler.skipSpan()).toBe(false); });
        context.with(ROOT_CONTEXT.setValue(MASTRA_TURN_SPAN_ACTIVE_KEY, true), () => {
            expect(handler.skipSpan()).toBe(true);
        });
    });

    it('preTracing marks the turn key and generates a turn scope', () => {
        const ctx = handler.preTracing({} as any, ROOT_CONTEXT, {}, ['hi', {}]);
        expect(ctx.getValue(MASTRA_TURN_SPAN_ACTIVE_KEY)).toBe(true);
        expect(getScopeFromContext(ctx, 'agentic.turn')).toBeTruthy();
    });

    it('preTracing reads an app-supplied session id but never fabricates one', () => {
        const withSession = handler.preTracing({} as any, ROOT_CONTEXT, {}, ['hi', { memory: { thread: 'thread-1' } }]);
        expect(getScopeFromContext(withSession, 'agentic.session')).toBe('thread-1');
        const noSession = handler.preTracing({} as any, ROOT_CONTEXT, {}, ['hi', {}]);
        expect(getScopeFromContext(noSession, 'agentic.session')).toBeUndefined();
    });

    it('resolveCompletion returns getFullOutput() for a streaming result, null otherwise', () => {
        const promise = Promise.resolve({ text: 'done' });
        const streamLike = { getFullOutput: () => promise };
        expect(handler.resolveCompletion({ returnValue: streamLike })).toBe(promise);
        expect(handler.resolveCompletion({ returnValue: { text: 'x' } })).toBeNull();
        expect(handler.resolveCompletion({ returnValue: null })).toBeNull();
    });
});

describe('Mastra methods config', () => {
    it('wraps Agent.generate and Agent.stream on @mastra/core/agent as turn spans', () => {
        for (const method of ['generate', 'stream']) {
            // Each method now has a turn AND an invocation entry; select the turn.
            const entry: any = mastraConfig.find(
                (c: any) => c.method === method && c.output_processor?.[0]?.type === 'agentic.turn',
            );
            expect(entry).toBeDefined();
            expect(entry.package).toBe('@mastra/core/agent');
            expect(entry.object).toBe('Agent');
            expect(entry.output_processor[0].type).toBe('agentic.turn');
            expect(entry.spanHandler.constructor.name).toBe('MastraTurnSpanHandler');
        }
    });

    it('wraps ModelRouterLanguageModel.doGenerate on @mastra/core/llm as an inference span', () => {
        const entry = (mastraConfig as any[]).find((c) => c.method === 'doGenerate');
        expect(entry).toBeDefined();
        expect(entry.package).toBe('@mastra/core/llm');
        expect(entry.object).toBe('ModelRouterLanguageModel');
        expect(entry.output_processor[0].type).toBe('inference');
        expect(entry.spanHandler.constructor.name).toBe('DefaultSpanHandler');
    });
});

// =============================================================================
// INFERENCE schema — inference (mastra.model.generate)
// =============================================================================
describe('Mastra INFERENCE schema', () => {
    it('declares the inference type', () => {
        expect(INFERENCE.type).toBe(SPAN_TYPES.INFERENCE);
    });

    describe('subtype (from finishReason)', () => {
        const subtype = (response: any) => (INFERENCE.subtype as Function)({ response });
        it('classifies a tool-calls finish as a tool_call inference', () => {
            expect(subtype({ finishReason: 'tool-calls' })).toBe(INFERENCE_TOOL_CALL);
        });
        it('classifies stop / length / missing as turn_end', () => {
            expect(subtype({ finishReason: 'stop' })).toBe(INFERENCE_TURN_END);
            expect(subtype({ finishReason: 'length' })).toBe(INFERENCE_TURN_END);
            expect(subtype(undefined)).toBe(INFERENCE_TURN_END);
        });
        it('handles the Mastra nested finishReason shape ({ unified })', () => {
            expect(subtype({ finishReason: { unified: 'tool-calls' } })).toBe(INFERENCE_TOOL_CALL);
            expect(subtype({ finishReason: { unified: 'stop' } })).toBe(INFERENCE_TURN_END);
        });
    });

    describe('provider type + endpoint (entity 1)', () => {
        const provType = (provider: string) => attrAccessor(INFERENCE, 'type', 0)({ instance: { provider } });
        it('maps router provider ids to inference.<provider>', () => {
            expect(provType('openai')).toBe('inference.openai');
            expect(provType('anthropic')).toBe('inference.anthropic');
            expect(provType('google')).toBe('inference.gemini');
            expect(provType('amazon-bedrock')).toBe('inference.aws_bedrock');
        });
        it('falls back to inference.generic when provider is absent', () => {
            expect(provType('')).toBe('inference.generic');
        });
        it('extracts a best-effort inference endpoint, undefined when unavailable', () => {
            const endpoint = (instance: any) => attrAccessor(INFERENCE, 'inference_endpoint', 0)({ instance });
            expect(endpoint({ config: { baseURL: 'https://api.openai.com/v1' } })).toBe('https://api.openai.com/v1');
            expect(endpoint({ gatewayId: 'models.dev' })).toBe('models.dev');
            expect(endpoint({})).toBeUndefined();
        });
    });

    describe('model attributes (entity 2, off the wrapper instance)', () => {
        it('type is model.llm.<modelId> and name is modelId', () => {
            expect(attrAccessor(INFERENCE, 'type', 1)({ instance: { modelId: 'gpt-5-mini' } })).toBe('model.llm.gpt-5-mini');
            expect(attrAccessor(INFERENCE, 'name', 1)({ instance: { modelId: 'gpt-5-mini' } })).toBe('gpt-5-mini');
        });
    });

    describe('tools declared (entity 3)', () => {
        const toolNames = (args: any[]) => attrAccessor(INFERENCE, 'name', 2)({ args });
        const toolType = (args: any[]) => attrAccessor(INFERENCE, 'type', 2)({ args });
        it('lists declared function-tool names and marks the tool type', () => {
            const args = [{ tools: [{ type: 'function', name: 'get_weather' }, { type: 'function', name: 'get_time' }] }];
            expect(toolNames(args)).toBe('get_weather, get_time');
            expect(toolType(args)).toBe('tool.function');
        });
        it('omits the tools entity when no tools are declared', () => {
            expect(toolNames([{}])).toBeUndefined();
            expect(toolType([{}])).toBeUndefined();
        });
    });

    describe('data.input (LanguageModelV2 prompt)', () => {
        const input = (args: any[]) => eventAccessor(INFERENCE, 'data.input', 'input')({ args });
        it('extracts system string content and user text parts', () => {
            const prompt = [
                { role: 'system', content: 'You are helpful.' },
                { role: 'user', content: [{ type: 'text', text: 'hi' }] },
            ];
            expect(input([{ prompt }])).toEqual([
                JSON.stringify({ system: 'You are helpful.' }),
                JSON.stringify({ user: 'hi' }),
            ]);
        });
        it('serializes assistant tool-call and tool-result parts (tool-using turns)', () => {
            const prompt = [
                { role: 'assistant', content: [{ type: 'tool-call', toolName: 'get_weather', input: '{"city":"NYC"}' }] },
                { role: 'tool', content: [{ type: 'tool-result', toolName: 'get_weather', output: 'sunny' }] },
            ];
            expect(input([{ prompt }])).toEqual([
                JSON.stringify({ assistant: JSON.stringify({ tool_call: { name: 'get_weather', arguments: '{"city":"NYC"}' } }) }),
                JSON.stringify({ tool: JSON.stringify({ tool_result: { name: 'get_weather', output: 'sunny' } }) }),
            ]);
        });
        it('returns [] when there is no prompt', () => {
            expect(input([{}])).toEqual([]);
            expect(input([])).toEqual([]);
        });
    });

    describe('data.output (result.content)', () => {
        const output = (bag: any) => eventAccessor(INFERENCE, 'data.output', 'response')(bag);
        it('joins text parts from content', () => {
            expect(output({ response: { content: [{ type: 'text', text: 'It is sunny.' }] } })).toBe('It is sunny.');
        });
        it('falls back to a serialized tool call when there is no text', () => {
            expect(output({ response: { content: [{ type: 'tool-call', toolName: 'get_weather', input: '{"city":"NYC"}' }] } }))
                .toBe(JSON.stringify({ name: 'get_weather', arguments: '{"city":"NYC"}' }));
        });
        it('returns the exception message on error', () => {
            expect(output({ exception: new Error('boom') })).toContain('boom');
        });
    });

    describe('metadata (tokens + finish reason)', () => {
        const metaEvent = () => (INFERENCE.events as any[]).find((e) => e.name === 'metadata');
        // The token bundle is the metadata attribute with no `attribute` key
        // (its returned dict is spread onto the event).
        const tokens = (response: any) => metaEvent().attributes.find((a: any) => !a.attribute).accessor({ response });
        const meta = (attr: string, response: any) => eventAccessor(INFERENCE, 'metadata', attr)({ response });

        it('extracts flat AI-SDK token numbers', () => {
            const usage = { inputTokens: 11, outputTokens: 22, totalTokens: 33 };
            expect(tokens({ usage })).toEqual({ prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 });
        });
        it('extracts Mastra nested token objects and computes total', () => {
            const usage = {
                inputTokens: { total: 125, cacheRead: 4 },
                outputTokens: { total: 512, text: 128, reasoning: 384 },
            };
            expect(tokens({ usage })).toEqual({
                prompt_tokens: 125, completion_tokens: 512, total_tokens: 637,
                reasoning_tokens: 384, cached_tokens: 4,
            });
        });
        it('omits reasoning/cached when zero or absent', () => {
            const usage = { inputTokens: { total: 5, cacheRead: 0 }, outputTokens: { total: 6 } };
            expect(tokens({ usage })).toEqual({ prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 });
        });
        it('returns undefined when there is no usage', () => {
            expect(tokens({})).toBeUndefined();
        });
        it('reports finish_reason and finish_type from a string or nested { unified }', () => {
            expect(meta('finish_reason', { finishReason: 'tool-calls' })).toBe('tool-calls');
            expect(meta('finish_reason', { finishReason: { unified: 'stop' } })).toBe('stop');
            expect(meta('finish_type', { finishReason: { unified: 'tool-calls' } })).toBe('tool_call');
            expect(meta('finish_type', { finishReason: 'stop' })).toBe('stop');
            expect(meta('finish_type', {})).toBe('unknown');
        });
    });
});

// =============================================================================
// INFERENCE_STREAM — streaming inference (mastra.model.stream)
// =============================================================================
describe('Mastra INFERENCE_STREAM (streaming)', () => {
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

    it('reuses the INFERENCE schema shape and adds a response_processor', () => {
        expect(INFERENCE_STREAM.type).toBe(SPAN_TYPES.INFERENCE);
        expect(INFERENCE_STREAM.attributes).toBe(INFERENCE.attributes);
        expect(INFERENCE_STREAM.events).toBe(INFERENCE.events);
        expect(typeof (INFERENCE_STREAM as any).response_processor).toBe('function');
    });

    it('observes text-delta + finish parts non-destructively and finalizes on close', async () => {
        const parts = [
            { type: 'stream-start' },
            { type: 'text-start', id: 'm1' },
            { type: 'text-delta', id: 'm1', delta: 'Hello' },
            { type: 'text-delta', id: 'm1', delta: ' world' },
            { type: 'text-end', id: 'm1' },
            { type: 'finish', finishReason: { unified: 'stop' }, usage: { inputTokens: { total: 3 }, outputTokens: { total: 5 } } },
        ];
        const returnValue: any = { stream: readableFrom(parts) };
        let finalReturnValue: any;
        (INFERENCE_STREAM as any).response_processor({
            returnValue,
            spanProcessor: ({ finalReturnValue: f }: any) => { finalReturnValue = f; },
        });

        // The app consumes the (now wrapped) stream — parts pass through unchanged.
        const seen = await drain(returnValue.stream);
        expect(seen.map((p: any) => p.type)).toEqual(parts.map((p) => p.type));
        expect(seen[2].delta).toBe('Hello');

        // finalize ran on close with a synthesized doGenerate-shaped result.
        expect(finalReturnValue.content).toEqual([{ type: 'text', text: 'Hello world' }]);
        expect(finalReturnValue.finishReason).toEqual({ unified: 'stop' });

        // The reused INFERENCE accessors read the synthesized result correctly.
        expect(eventAccessor(INFERENCE_STREAM, 'data.output', 'response')({ response: finalReturnValue })).toBe('Hello world');
        const tokenAcc = (INFERENCE_STREAM.events as any[]).find((e) => e.name === 'metadata').attributes.find((a: any) => !a.attribute).accessor;
        expect(tokenAcc({ response: finalReturnValue })).toEqual({ prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 });
        expect((INFERENCE_STREAM.subtype as Function)({ response: finalReturnValue })).toBe(INFERENCE_TURN_END);
    });

    it('accumulates a streamed tool-call into the output', async () => {
        const parts = [
            { type: 'tool-call', toolName: 'get_weather', input: '{"city":"NYC"}' },
            { type: 'finish', finishReason: { unified: 'tool-calls' }, usage: { inputTokens: { total: 2 }, outputTokens: { total: 1 } } },
        ];
        const returnValue: any = { stream: readableFrom(parts) };
        let finalReturnValue: any;
        (INFERENCE_STREAM as any).response_processor({
            returnValue,
            spanProcessor: ({ finalReturnValue: f }: any) => { finalReturnValue = f; },
        });
        await drain(returnValue.stream);
        expect(eventAccessor(INFERENCE_STREAM, 'data.output', 'response')({ response: finalReturnValue }))
            .toContain('get_weather');
        expect((INFERENCE_STREAM.subtype as Function)({ response: finalReturnValue })).toBe(INFERENCE_TOOL_CALL);
    });

    it('finalizes immediately for a non-stream return value', () => {
        let finalReturnValue: any;
        (INFERENCE_STREAM as any).response_processor({
            returnValue: { content: [{ type: 'text', text: 'x' }] },
            spanProcessor: ({ finalReturnValue: f }: any) => { finalReturnValue = f; },
        });
        expect(finalReturnValue).toEqual({ content: [{ type: 'text', text: 'x' }] });
    });
});

describe('Mastra TOOL schema', () => {
    it('declares the agentic.tool.invocation type', () => {
        expect(TOOL.type).toBe(SPAN_TYPES.AGENTIC_TOOL_INVOCATION);
    });

    it('reads tool name and description from the tool instance', () => {
        const instance = { id: 'get-weather', description: 'Get current weather for a location' };
        expect(attrAccessor(TOOL, 'type')({})).toBe('tool.mastra');
        expect(attrAccessor(TOOL, 'name')({ instance })).toBe('get-weather');
        expect(attrAccessor(TOOL, 'description')({ instance })).toBe('Get current weather for a location');
    });

    it('returns empty strings when the tool has no id or description', () => {
        expect(attrAccessor(TOOL, 'name')({ instance: {} })).toBe('');
        expect(attrAccessor(TOOL, 'description')({ instance: {} })).toBe('');
    });

    it('reads the owning agent from the stamp the wrapper leaves on the tool', () => {
        const instance = { id: 'get-weather', __monocleAgent: { name: 'Weather Agent' } };
        expect(attrAccessor(TOOL, 'name', 1)({ instance })).toBe('Weather Agent');
        expect(attrAccessor(TOOL, 'type', 1)({})).toBe('agent.mastra');
    });

    it('leaves the agent name empty when the tool was never stamped', () => {
        expect(attrAccessor(TOOL, 'name', 1)({ instance: { id: 'x' } })).toBe('');
    });

    it('records the model-produced args as data.input', () => {
        const acc = eventAccessor(TOOL, 'data.input', 'Inputs');
        expect(acc({ args: [{ location: 'Tokyo' }] })).toEqual([JSON.stringify({ location: 'Tokyo' })]);
    });

    it('records an empty input when the tool takes no args', () => {
        expect(eventAccessor(TOOL, 'data.input', 'Inputs')({ args: [] })).toEqual(['']);
    });

    it('records the tool result as data.output', () => {
        const acc = eventAccessor(TOOL, 'data.output', 'response');
        expect(acc({ response: { temperature: 21 } })).toBe(JSON.stringify({ temperature: 21 }));
        expect(acc({ response: 'sunny' })).toBe('sunny');
        expect(acc({ response: undefined })).toBe('');
    });

    it('records the exception message when the tool throws', () => {
        const acc = eventAccessor(TOOL, 'data.output', 'response');
        expect(acc({ exception: new Error('geocoding failed') })).toContain('geocoding failed');
    });
});

describe('mastraToolWrapper', () => {
    let provider: NodeTracerProvider;
    let memExporter: InMemorySpanExporter;
    let tracer: any;

    const toolElement: any = {
        package: '@mastra/core/agent',
        object: 'Agent',
        method: 'convertTools',
    };

    const makeAgent = (name = 'Weather Agent') => ({ id: 'weather-agent', name });

    // Mirrors _patchMainMethodName's 7-arg contract: the wrapper replaces the
    // call and invokes `wrapped` itself.
    const runWrapper = (original: Function, agent: any = makeAgent()) =>
        mastraToolWrapper(tracer, undefined, toolElement, original, agent, '', [{}]);

    // Without a real context manager, context.with() is a no-op and span
    // creation recurses.
    beforeAll(() => { context.setGlobalContextManager(new AsyncHooksContextManager().enable()); });
    afterAll(() => { context.disable(); });

    beforeEach(() => {
        memExporter = new InMemorySpanExporter();
        provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memExporter)] });
        tracer = provider.getTracer('test');
    });

    afterEach(async () => {
        await provider.shutdown();
    });

    it('returns the original tool map', async () => {
        const original = async () => ({ 'get-weather': { id: 'get-weather', execute: async () => 'sunny' } });
        const out: any = await runWrapper(original);
        expect(Object.keys(out)).toEqual(['get-weather']);
    });

    it('replaces execute and still returns the tool result', async () => {
        const tool: any = { id: 'get-weather', execute: async (input: any) => `weather for ${input.location}` };
        const originalExecute = tool.execute;
        const out: any = await runWrapper(async () => ({ 'get-weather': tool }));

        expect(out['get-weather'].execute).not.toBe(originalExecute);
        await expect(out['get-weather'].execute({ location: 'Tokyo' })).resolves.toBe('weather for Tokyo');
    });

    it('emits a mastra.tool span when the tool is executed', async () => {
        const tool: any = { id: 'get-weather', description: 'Get weather', execute: async () => 'sunny' };
        const out: any = await runWrapper(async () => ({ 'get-weather': tool }));

        expect(memExporter.getFinishedSpans()).toHaveLength(0); // nothing yet — acquisition is not traced
        await out['get-weather'].execute({ location: 'Tokyo' });

        // Two spans: the tool span plus the workflow root Monocle synthesizes
        // when nothing encloses it.
        const spans = memExporter.getFinishedSpans();
        const toolSpan: any = spans.find((s: any) => s.name === 'mastra.tool');
        expect(toolSpan).toBeDefined();
        expect(toolSpan.attributes['span.type']).toBe(SPAN_TYPES.AGENTIC_TOOL_INVOCATION);
        expect(toolSpan.attributes['entity.1.name']).toBe('get-weather');
        expect(toolSpan.attributes['entity.1.type']).toBe('tool.mastra');
        expect(toolSpan.attributes['entity.2.name']).toBe('Weather Agent');
        expect(toolSpan.events.map((e: any) => e.name)).toEqual(
            expect.arrayContaining(['data.input', 'data.output']),
        );
    });

    it('parents the tool span under the active span at execution time', async () => {
        const tool: any = { id: 'get-weather', execute: async () => 'sunny' };
        const out: any = await runWrapper(async () => ({ 'get-weather': tool }));

        const turn = tracer.startSpan('mastra.agent.stream');
        await context.with(trace.setSpan(context.active(), turn), () =>
            out['get-weather'].execute({ location: 'Tokyo' }),
        );
        turn.end();

        const spans = memExporter.getFinishedSpans();
        const toolSpan = spans.find((s: any) => s.name === 'mastra.tool');
        // Narrows the type and fails readably if the span was never emitted.
        if (!toolSpan) throw new Error('no mastra.tool span was emitted');

        expect((toolSpan as any).parentSpanContext?.spanId ?? (toolSpan as any).parentSpanId)
            .toBe(turn.spanContext().spanId);
        expect(toolSpan.spanContext().traceId).toBe(turn.spanContext().traceId);
    });

    it('stamps the owning agent onto each tool', async () => {
        const out: any = await runWrapper(
            async () => ({ 'get-weather': { id: 'get-weather', execute: async () => 1 } }),
            makeAgent('Weather Agent'),
        );
        expect(out['get-weather'].__monocleAgent).toEqual({ name: 'Weather Agent', id: 'weather-agent' });
    });

    it('does not double-wrap a tool that passed through before', async () => {
        const tool: any = { id: 'get-weather', execute: async () => 1 };
        const first: any = await runWrapper(async () => ({ 'get-weather': tool }));
        const wrappedOnce = first['get-weather'].execute;

        const second: any = await runWrapper(async () => first);
        expect(second['get-weather'].execute).toBe(wrappedOnce);
    });

    it('leaves tools without a function execute untouched', async () => {
        const out: any = await runWrapper(async () => ({ 'no-exec': { id: 'no-exec' } }));
        expect(out['no-exec'].execute).toBeUndefined();
    });

    it('propagates a rejection from convertTools', async () => {
        await expect(
            runWrapper(async () => { throw new Error('tool resolution failed'); }),
        ).rejects.toThrow('tool resolution failed');
    });

    it('survives a non-object return without throwing', async () => {
        await expect(runWrapper(async () => undefined)).resolves.toBeUndefined();
    });
});

describe('Mastra tool config entry', () => {
    it('patches Agent.convertTools with the tool wrapper', () => {
        const entry: any = mastraConfig.find((c: any) => c.method === 'convertTools');
        expect(entry).toBeDefined();
        expect(entry.package).toBe('@mastra/core/agent');
        expect(entry.object).toBe('Agent');
        expect(typeof entry.wrapperMethod).toBe('function');
    });

    it('creates no span for the acquisition call itself', () => {
        const entry: any = mastraConfig.find((c: any) => c.method === 'convertTools');
        expect(entry.spanName).toBeUndefined();
        expect(entry.output_processor).toBeUndefined();
    });

    it('leaves the existing turn and inference entries intact', () => {
        const methods = mastraConfig.map((c: any) => c.method).sort();
        // generate/stream appear twice each: one turn entry, one invocation entry.
        expect(methods).toEqual([
            'convertTools', 'doGenerate', 'doStream', 'generate', 'generate', 'stream', 'stream',
        ]);
    });
});

describe('Mastra AGENT_INVOCATION schema', () => {
    // Delegation accessors read context.active(), so a real context manager is
    // required — without one context.with() is a no-op.
    beforeAll(() => { context.setGlobalContextManager(new AsyncHooksContextManager().enable()); });
    afterAll(() => { context.disable(); });

    it('declares the agentic.invocation type', () => {
        expect(AGENT_INVOCATION.type).toBe(SPAN_TYPES.AGENTIC_INVOCATION);
        expect(AGENT_INVOCATION.subtype).toBe(SPAN_SUBTYPES.CONTENT_PROCESSING);
    });

    it('reads agent identity from the Agent instance', () => {
        expect(attrAccessor(AGENT_INVOCATION, 'type')({})).toBe('agent.mastra');
        expect(attrAccessor(AGENT_INVOCATION, 'name')({ instance: { name: 'Weather Agent' } }))
            .toBe('Weather Agent');
        expect(attrAccessor(AGENT_INVOCATION, 'description')({
            instance: { getDescription: () => 'Answers weather questions' },
        })).toBe('Answers weather questions');
    });

    it('omits delegation attributes on a top-level invocation', () => {
        context.with(ROOT_CONTEXT, () => {
            expect(attrAccessor(AGENT_INVOCATION, 'from_agent')({})).toBeUndefined();
            expect(attrAccessor(AGENT_INVOCATION, 'from_agent_span_id')({})).toBeUndefined();
        });
    });

    it('emits delegation attributes when a parent agent handed off', () => {
        // from_agent comes off the context; the span id comes from the parent span.
        const parentSpan = { spanContext: () => ({ spanId: 'abc123' }) };
        context.with(ROOT_CONTEXT.setValue(FROM_AGENT_KEY, 'Weather Agent'), () => {
            expect(attrAccessor(AGENT_INVOCATION, 'from_agent')({})).toBe('Weather Agent');
            expect(attrAccessor(AGENT_INVOCATION, 'from_agent_span_id')({ parentSpan })).toBe('abc123');
        });
    });

    it('reuses the shared message normalizers for input and output', () => {
        expect(eventAccessor(AGENT_INVOCATION, 'data.input', 'input')({ args: ['weather in Tokyo?'] }))
            .toEqual([JSON.stringify({ user: 'weather in Tokyo?' })]);
        expect(eventAccessor(AGENT_INVOCATION, 'data.output', 'response')({ response: { text: 'Sunny.' } }))
            .toBe('Sunny.');
        expect(eventAccessor(AGENT_INVOCATION, 'data.output', 'response')({ exception: new Error('boom') }))
            .toContain('boom');
    });
});

describe('MastraInvocationSpanHandler', () => {
    const handler = new MastraInvocationSpanHandler();

    beforeAll(() => { context.setGlobalContextManager(new AsyncHooksContextManager().enable()); });
    afterAll(() => { context.disable(); });

    // Only same-agent re-entry is skipped; a nested sub-agent still gets a span.
    it('never skips, even inside an active turn', () => {
        const call = () =>
            handler.skipSpan({ instance: {}, args: [] as any, element: {} as any });
        expect(call()).toBe(false);
        context.with(ROOT_CONTEXT.setValue(MASTRA_TURN_SPAN_ACTIVE_KEY, true), () => {
            expect(call()).toBe(false);
        });
    });

    it('claims itself as the active agent for descendants', () => {
        const ctx = handler.preTracing({} as any, ROOT_CONTEXT, { name: 'Weather Agent' }, []);
        expect(ctx.getValue(MASTRA_AGENT_NAME_KEY)).toBe('Weather Agent');
    });

    it('generates a fresh agentic.invocation scope per activation', () => {
        const ctx = handler.preTracing({} as any, ROOT_CONTEXT, { name: 'Weather Agent' }, []);
        expect(getScopeFromContext(ctx, 'agentic.invocation')).toBeTruthy();
    });

    it('stamps from_agent when a different agent was already active', () => {
        const parent = ROOT_CONTEXT.setValue(MASTRA_AGENT_NAME_KEY, 'Weather Agent');
        const ctx = handler.preTracing({} as any, parent, { name: 'Sub Agent' }, []);
        expect(ctx.getValue(FROM_AGENT_KEY)).toBe('Weather Agent');
        expect(ctx.getValue(MASTRA_AGENT_NAME_KEY)).toBe('Sub Agent');
    });

    it('does not stamp from_agent when the same agent re-enters', () => {
        const parent = ROOT_CONTEXT.setValue(MASTRA_AGENT_NAME_KEY, 'Weather Agent');
        const ctx = handler.preTracing({} as any, parent, { name: 'Weather Agent' }, []);
        expect(ctx.getValue(FROM_AGENT_KEY)).toBeUndefined();
    });
});

describe('Mastra invocation config entries', () => {
    it('adds an invocation entry for both generate and stream', () => {
        for (const method of ['generate', 'stream']) {
            const entries = mastraConfig.filter((c: any) => c.method === method && c.object === 'Agent');
            expect(entries).toHaveLength(2);
            const types = entries.map((e: any) => e.output_processor[0].type);
            expect(types).toEqual(['agentic.turn', 'agentic.invocation']);
        }
    });

    // Element 0 nests outside element 1, so the turn entry must come first.
    it('orders the turn entry before the invocation entry', () => {
        const idx = (t: string) =>
            mastraConfig.findIndex((c: any) => c.method === 'generate' && c.output_processor?.[0]?.type === t);
        expect(idx('agentic.turn')).toBeLessThan(idx('agentic.invocation'));
    });
});

// Exercises the real grouping machinery, not the config shape.
describe('turn + invocation nesting (real spans)', () => {
    let provider: NodeTracerProvider;
    let memExporter: InMemorySpanExporter;
    let tracer: any;

    beforeAll(() => { context.setGlobalContextManager(new AsyncHooksContextManager().enable()); });
    afterAll(() => { context.disable(); });

    beforeEach(() => {
        memExporter = new InMemorySpanExporter();
        provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memExporter)] });
        tracer = provider.getTracer('test');
    });

    afterEach(async () => { await provider.shutdown(); });

    // Mirrors what _getOnPatchMain does for a multi-element group. The patched
    // function forwards via `arguments`, so it infers as `() => any`; the return
    // type here reflects what it actually accepts.
    function patchGenerate(agent: any, impl: Function): (...args: any[]) => Promise<any> {
        const elements = mastraConfig
            .filter((c: any) => c.method === 'generate' && c.object === 'Agent')
            .map((c: any) => ({ ...c, tracer }));
        return getPatchedMainList(elements as any)(impl).bind(agent) as (...args: any[]) => Promise<any>;
    }

    it('emits a turn span wrapping an invocation span for a top-level call', async () => {
        const agent = { name: 'Weather Agent', id: 'weather-agent' };
        const generate = patchGenerate(agent, async () => ({ text: 'Sunny.' }));

        await generate('weather in Tokyo?');

        const spans = memExporter.getFinishedSpans();
        const turn = spans.find((s: any) => s.attributes['span.type'] === 'agentic.turn');
        const invoke = spans.find((s: any) => s.attributes['span.type'] === 'agentic.invocation');
        if (!turn || !invoke) throw new Error('expected both a turn and an invocation span');

        expect(turn.name).toBe('mastra.agent.generate');
        expect(invoke.name).toBe('mastra.agent.invoke');
        // Invocation nests inside the turn.
        expect((invoke as any).parentSpanContext?.spanId ?? (invoke as any).parentSpanId)
            .toBe(turn.spanContext().spanId);
        expect(invoke.attributes['entity.1.name']).toBe('Weather Agent');
    });

    // Inside an active turn the turn span is suppressed, but the invocation
    // span must still open — the gap this feature fills.
    it('emits only an invocation span for a nested agent call', async () => {
        const sub = { name: 'Sub Agent', id: 'sub-agent' };
        const generate = patchGenerate(sub, async () => ({ text: 'delegated answer' }));

        const parentCtx = ROOT_CONTEXT
            .setValue(MASTRA_TURN_SPAN_ACTIVE_KEY, true)
            .setValue(MASTRA_AGENT_NAME_KEY, 'Weather Agent');
        await context.with(parentCtx, () => generate('sub task'));

        const spans = memExporter.getFinishedSpans();
        expect(spans.filter((s: any) => s.attributes['span.type'] === 'agentic.turn')).toHaveLength(0);

        const invoke = spans.find((s: any) => s.attributes['span.type'] === 'agentic.invocation');
        if (!invoke) throw new Error('expected an invocation span for the nested agent');
        expect(invoke.attributes['entity.1.name']).toBe('Sub Agent');
        // Delegation is recorded against the agent that was already active.
        expect(invoke.attributes['entity.1.from_agent']).toBe('Weather Agent');
    });
});

describe('MastraInvocationSpanHandler re-entry', () => {
    const handler = new MastraInvocationSpanHandler();
    const skip = (instance: any) =>
        handler.skipSpan({ instance, args: [] as any, element: {} as any });

    beforeAll(() => { context.setGlobalContextManager(new AsyncHooksContextManager().enable()); });
    afterAll(() => { context.disable(); });

    // Mastra re-enters its own methods within one activation, which was emitting
    // two identical invocation spans.
    it('skips when the same agent is already active', () => {
        context.with(ROOT_CONTEXT.setValue(MASTRA_AGENT_NAME_KEY, 'Supervisor Agent'), () => {
            expect(skip({ name: 'Supervisor Agent' })).toBe(true);
        });
    });

    it('does not skip a genuinely different agent', () => {
        context.with(ROOT_CONTEXT.setValue(MASTRA_AGENT_NAME_KEY, 'Supervisor Agent'), () => {
            expect(skip({ name: 'Weather Agent' })).toBe(false);
        });
    });

    it('does not skip at the top level', () => {
        context.with(ROOT_CONTEXT, () => {
            expect(skip({ name: 'Supervisor Agent' })).toBe(false);
        });
    });

    // Two separate activations: the supervisor is active again between them.
    it('does not skip a repeat delegation to the same sub-agent', () => {
        context.with(ROOT_CONTEXT.setValue(MASTRA_AGENT_NAME_KEY, 'Supervisor Agent'), () => {
            expect(skip({ name: 'Weather Agent' })).toBe(false);
            expect(skip({ name: 'Weather Agent' })).toBe(false);
        });
    });
});

describe('mastraToolWrapper — agent-delegation tools', () => {
    let provider: NodeTracerProvider;
    let memExporter: InMemorySpanExporter;
    let tracer: any;
    const toolElement: any = { package: '@mastra/core/agent', object: 'Agent', method: 'convertTools' };

    beforeAll(() => { context.setGlobalContextManager(new AsyncHooksContextManager().enable()); });
    afterAll(() => { context.disable(); });

    beforeEach(() => {
        memExporter = new InMemorySpanExporter();
        provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memExporter)] });
        tracer = provider.getTracer('test');
    });
    afterEach(async () => { await provider.shutdown(); });

    // Mastra exposes each sub-agent as an `agent-<key>` tool, so delegation shows
    // up as a tool call. That span sits between the delegating agent's invocation
    // and the sub-agent's, which is Mastra plumbing rather than anything the user
    // wrote — skip it so the sub-agent parents straight to its delegator.
    const supervisor = {
        name: 'Supervisor Agent',
        id: 'supervisor-agent',
        listAgents: () => ({ weatherAgent: {}, excuseGeneratorAgent: {} }),
    };

    it('leaves delegation tools unwrapped', async () => {
        const tools: any = {
            'agent-weatherAgent': { id: 'agent-weatherAgent', execute: async () => 'delegated' },
            'get-weather': { id: 'get-weather', execute: async () => 'sunny' },
        };
        const originalDelegate = tools['agent-weatherAgent'].execute;

        const out: any = await mastraToolWrapper(
            tracer, undefined, toolElement, async () => tools, supervisor, '', [{}],
        );

        expect(out['agent-weatherAgent'].execute).toBe(originalDelegate); // untouched
        expect(out['get-weather'].execute).not.toBe(undefined);
    });

    it('emits no span when a delegation tool runs, but still does for a real tool', async () => {
        const tools: any = {
            'agent-weatherAgent': { id: 'agent-weatherAgent', execute: async () => 'delegated' },
            'get-weather': { id: 'get-weather', execute: async () => 'sunny' },
        };
        const out: any = await mastraToolWrapper(
            tracer, undefined, toolElement, async () => tools, supervisor, '', [{}],
        );

        await out['agent-weatherAgent'].execute({});
        expect(memExporter.getFinishedSpans().filter((s: any) => s.name === 'mastra.tool')).toHaveLength(0);

        await out['get-weather'].execute({ location: 'Tokyo' });
        const toolSpans = memExporter.getFinishedSpans().filter((s: any) => s.name === 'mastra.tool');
        expect(toolSpans).toHaveLength(1);
        expect(toolSpans[0].attributes['entity.1.name']).toBe('get-weather');
    });

    it('still wraps everything when the agent has no sub-agents', async () => {
        const plain = { name: 'Weather Agent', id: 'weather-agent', listAgents: () => ({}) };
        const tools: any = { 'get-weather': { id: 'get-weather', execute: async () => 'sunny' } };
        const original = tools['get-weather'].execute;

        const out: any = await mastraToolWrapper(
            tracer, undefined, toolElement, async () => tools, plain, '', [{}],
        );
        expect(out['get-weather'].execute).not.toBe(original);
    });

    // listAgents is Mastra API surface; a version without it must not break tracing.
    it('falls back to wrapping everything if listAgents is unavailable', async () => {
        const odd = { name: 'Odd Agent', id: 'odd' };
        const tools: any = { 'get-weather': { id: 'get-weather', execute: async () => 'sunny' } };
        const original = tools['get-weather'].execute;

        const out: any = await mastraToolWrapper(
            tracer, undefined, toolElement, async () => tools, odd, '', [{}],
        );
        expect(out['get-weather'].execute).not.toBe(original);
    });
});

describe('AGENT_INVOCATION from_agent_span_id', () => {
    beforeAll(() => { context.setGlobalContextManager(new AsyncHooksContextManager().enable()); });
    afterAll(() => { context.disable(); });

    const spanId = (id: string) => ({ spanContext: () => ({ spanId: id }) });
    const acc = () => attrAccessor(AGENT_INVOCATION, 'from_agent_span_id');

    // With the delegation tool span skipped, the parent of a sub-agent's
    // invocation is its delegator's invocation — same shape as ADK.
    it('reports the delegating agent span when a delegation happened', () => {
        context.with(ROOT_CONTEXT.setValue(FROM_AGENT_KEY, 'Supervisor Agent'), () => {
            expect(acc()({ parentSpan: spanId('f6aa6253da3d9285') })).toBe('f6aa6253da3d9285');
        });
    });

    it('stays empty on a top-level invocation', () => {
        context.with(ROOT_CONTEXT, () => {
            expect(acc()({ parentSpan: spanId('f6aa6253da3d9285') })).toBeUndefined();
        });
    });

    it('stays empty when no parent span is available', () => {
        context.with(ROOT_CONTEXT.setValue(FROM_AGENT_KEY, 'Supervisor Agent'), () => {
            expect(acc()({})).toBeUndefined();
            expect(acc()({ parentSpan: {} })).toBeUndefined();
        });
    });
});

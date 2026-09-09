import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { getPatchedMain } from '../../src/instrumentation/common/wrapper';
import { setScopesInternal } from '../../src/instrumentation/common/utils';
import { config as agentsConfig } from '../../src/instrumentation/metamodel/agents/methods';
import { config as openaiConfig } from '../../src/instrumentation/metamodel/openai/methods';

// Drives the real monocle pipeline end to end: the actual wrapper
// (getPatchedMain), the real agents MethodConfig, and OTel span emission through
// an in-memory exporter.
//
// @openai/agents is not loaded. It cannot be installed here — 0.4.0+ requires a
// zod 4 peer that npm will not place beside the langchain stack's zod 3 — so
// this follows test/integration/mastra.test.ts and feeds the instrumentation
// realistic payloads instead of loading the framework.
//
// The payloads and event order below were captured from live runs of the SDK
// with a scripted stub Model, identical on 0.3.9, 0.5.0 and 0.17.0:
//
//   agent_start       Triage
//   agent_tool_start  Triage  get_weather  call_1
//   agent_tool_end    Triage  get_weather  "sunny in SFO"  call_1
//   agent_handoff     Triage -> Billing
//   agent_start       Billing
//   agent_end         Billing  "billing handled"
//
// A delegating agent receives no agent_end. Every event is emitted on the Runner
// itself, which is why FakeRunner is an EventEmitter.

const exporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;
let tracer: any;

beforeAll(() => {
    context.setGlobalContextManager(new AsyncHooksContextManager().enable());
    provider = new NodeTracerProvider({
        resource: resourceFromAttributes({ SERVICE_NAME: 'openai-agents-integration-test' }),
        spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    tracer = provider.getTracer('openai-agents-integration-test');
});

afterAll(() => {
    context.disable();
});

beforeEach(() => {
    exporter.reset();
});

// --- SDK-shaped fixtures ----------------------------------------------------

function fakeAgent(name: string, extra: Record<string, unknown> = {}) {
    return { name, instructions: `instructions for ${name}`, ...extra };
}

function fakeTool(name: string, description: string) {
    return { type: 'function', name, description };
}

// The SDK creates one RunContext per run and passes that same instance to every
// event, which is how the bridge tells concurrent runs apart — so reuse one per
// run rather than minting one per emit.
function fakeRunContext() {
    return { usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } };
}

// Runner-shaped emitter: `script` emits the lifecycle a test wants, `result` is
// what Runner.run resolves to.
class FakeRunner extends EventEmitter {
    constructor(
        private script: (runner: FakeRunner, runContext: any) => Promise<void> | void,
        private result: any,
    ) {
        super();
    }

    // Async on purpose: the real Runner.run awaits between emits, so this is
    // what exercises the bridge's context read across await boundaries.
    async run(_agent: any, _input: any, options?: any) {
        // The SDK reuses an app-supplied RunContext verbatim rather than making
        // a fresh one, so a test can hand the same instance to two runs.
        const runContext = options?.context ?? fakeRunContext();
        await Promise.resolve();
        await this.script(this, runContext);
        await Promise.resolve();
        return this.result;
    }
}

// Models Runner.run({ stream: true }): it resolves at stream *setup*, kicking
// the agent loop off without awaiting it, and returns a StreamedRunResult whose
// `completed` promise settles when the loop finishes.
class FakeStreamingRunner extends EventEmitter {
    constructor(
        private script: (runner: FakeStreamingRunner, runContext: any) => Promise<void>,
        private result: any,
    ) {
        super();
    }

    async run(_agent: any, _input: any, _options?: any) {
        const runContext = fakeRunContext();
        let done = false;
        // Not awaited — exactly what #runIndividualStream does.
        const loop = (async () => {
            await new Promise((r) => setTimeout(r, 5));
            await this.script(this, runContext);
            done = true;
        })();
        const result = this.result;
        return {
            completed: loop,
            // undefined until the stream drains, as StreamedRunResult is
            get finalOutput() {
                return done ? result.finalOutput : undefined;
            },
        };
    }
}

function patchStreamingRunner() {
    const entry = (agentsConfig as any[]).find(
        (c) => c.object === 'Runner' && c.method === 'run',
    );
    if (!(FakeStreamingRunner.prototype.run as any).__monoclePatched) {
        const patched = getPatchedMain({ ...entry, tracer } as any)(
            FakeStreamingRunner.prototype.run,
        );
        (patched as any).__monoclePatched = true;
        FakeStreamingRunner.prototype.run = patched as any;
    }
}

// Patches FakeRunner.prototype.run with the real config entry, as the
// instrumentor would patch Runner.prototype.run.
function patchRunner() {
    const entry = (agentsConfig as any[]).find(
        (c) => c.object === 'Runner' && c.method === 'run',
    );
    if (!entry) throw new Error('no agents config entry for Runner.run');
    if (!(FakeRunner.prototype.run as any).__monoclePatched) {
        const patched = getPatchedMain({ ...entry, tracer } as any)(FakeRunner.prototype.run);
        (patched as any).__monoclePatched = true;
        FakeRunner.prototype.run = patched as any;
    }
}

// Stands in for openai's Responses resource, patched with the real openai config
// entry so the inference span takes the same path a live run does.
class FakeResponses {
    async create(_params: any) {
        return {
            model: 'gpt-4o',
            output_text: 'It is sunny.',
            usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
        };
    }
}

function patchOpenAIResponses() {
    const entry = (openaiConfig as any[]).find((c) => c.spanName === 'openai_responses');
    if (!entry) throw new Error('no openai config entry for openai_responses');
    if (!(FakeResponses.prototype.create as any).__monoclePatched) {
        const patched = getPatchedMain({ ...entry, tracer } as any)(FakeResponses.prototype.create);
        (patched as any).__monoclePatched = true;
        FakeResponses.prototype.create = patched as any;
    }
}

function spansByName(name: string) {
    return exporter.getFinishedSpans().filter((s) => s.name === name);
}

// OTel renamed this between SDK majors.
function parentIdOf(span: any): string | undefined {
    return span?.parentSpanContext?.spanId ?? span?.parentSpanId;
}

// --- Tests ------------------------------------------------------------------

describe('@openai/agents instrumentation', () => {
    it('emits an agentic.turn span for Runner.run', async () => {
        patchRunner();
        const agent = fakeAgent('Solo');
        const runner = new FakeRunner(
            (r, ctx) => {
                r.emit('agent_start', ctx, agent, []);
                r.emit('agent_end', ctx, agent, 'all done');
            },
            { finalOutput: 'all done' },
        );

        const result = await runner.run(agent, 'are we done?');
        expect(result.finalOutput).toBe('all done');

        const turnSpans = spansByName('openai_agents.runner.run');
        expect(turnSpans, 'expected one openai_agents.runner.run span').toHaveLength(1);
        expect(turnSpans[0].attributes['span.type']).toBe('agentic.turn');
        expect(turnSpans[0].attributes['span.subtype']).toBe('turn');
    });

    it('records the turn framework entity, input and final output', async () => {
        patchRunner();
        const agent = fakeAgent('Solo');
        const runner = new FakeRunner(
            (r, ctx) => {
                r.emit('agent_start', ctx, agent, []);
                r.emit('agent_end', ctx, agent, 'all done');
            },
            { finalOutput: 'all done' },
        );

        await runner.run(agent, 'are we done?');

        const turn = spansByName('openai_agents.runner.run')[0];
        expect(turn.attributes['entity.1.type']).toBe('agent.openai_agents');

        const input = turn.events.find((e: any) => e.name === 'data.input');
        expect(input, 'expected a data.input event').toBeDefined();
        expect(String(input!.attributes!.input)).toContain('are we done?');

        const output = turn.events.find((e: any) => e.name === 'data.output');
        expect(output, 'expected a data.output event').toBeDefined();
        expect(String(output!.attributes!.response)).toContain('all done');
    });

    it('emits an agentic.invocation span per agent activation, nested under the turn', async () => {
        patchRunner();
        const agent = fakeAgent('Solo', { handoffDescription: 'the only agent' });
        const runner = new FakeRunner(
            (r, ctx) => {
                r.emit('agent_start', ctx, agent, []);
                r.emit('agent_end', ctx, agent, 'all done');
            },
            { finalOutput: 'all done' },
        );

        await runner.run(agent, 'are we done?');

        const invocations = spansByName('openai_agents.agent');
        expect(invocations, 'expected one openai_agents.agent span').toHaveLength(1);

        const invocation = invocations[0];
        expect(invocation.attributes['span.type']).toBe('agentic.invocation');
        expect(invocation.attributes['span.subtype']).toBe('content_processing');
        expect(invocation.attributes['entity.1.type']).toBe('agent.openai_agents');
        expect(invocation.attributes['entity.1.name']).toBe('Solo');
        expect(invocation.attributes['entity.1.instructions']).toBe('instructions for Solo');

        const outEvent = invocation.events.find((e: any) => e.name === 'data.output');
        expect(String(outEvent!.attributes!.response)).toContain('all done');

        // Must hang off the turn span, not off whatever was active when the
        // listener fired.
        const turn = spansByName('openai_agents.runner.run')[0];
        expect(parentIdOf(invocation)).toBe(turn.spanContext().spanId);
    });

    it('stamps from_agent provenance across a handoff and closes the delegating agent', async () => {
        patchRunner();
        const triage = fakeAgent('Triage');
        const billing = fakeAgent('Billing');
        const runner = new FakeRunner(
            (r, ctx) => {
                // No agent_end for Triage: the handoff ends its activation.
                r.emit('agent_start', ctx, triage, []);
                r.emit('agent_handoff', ctx, triage, billing);
                r.emit('agent_start', ctx, billing, []);
                r.emit('agent_end', ctx, billing, 'billing handled');
            },
            { finalOutput: 'billing handled' },
        );

        await runner.run(triage, 'I have a billing question');

        const invocations = spansByName('openai_agents.agent');
        expect(invocations, 'expected one span per agent activation').toHaveLength(2);

        const [first, second] = invocations;
        expect(first.attributes['entity.1.name']).toBe('Triage');
        expect(second.attributes['entity.1.name']).toBe('Billing');

        // Closed despite never receiving agent_end, recording its target.
        expect(first.endTime, 'delegating agent span must be ended').toBeDefined();
        const firstOut = first.events.find((e: any) => e.name === 'data.output');
        expect(String(firstOut!.attributes!.response)).toContain('Billing');

        // Delegation surfaces as provenance on the delegated agent rather than
        // as a separate agentic.delegation span.
        expect(second.attributes['entity.1.from_agent']).toBe('Triage');
        expect(second.attributes['entity.1.from_agent_span_id'])
            .toBe(first.spanContext().spanId);

        // Nothing delegated to the first activation.
        expect(first.attributes['entity.1.from_agent']).toBeUndefined();

        const turn = spansByName('openai_agents.runner.run')[0];
        expect(parentIdOf(first)).toBe(turn.spanContext().spanId);
        expect(parentIdOf(second)).toBe(turn.spanContext().spanId);
    });

    it('emits a tool span carrying both the tool and the calling agent, nested under the invocation', async () => {
        patchRunner();
        const agent = fakeAgent('Triage');
        const tool = fakeTool('get_weather', 'Get weather for a city');
        const toolCall = { callId: 'call_1', name: 'get_weather', arguments: '{"city":"SFO"}' };
        const runner = new FakeRunner(
            (r, ctx) => {
                r.emit('agent_start', ctx, agent, []);
                r.emit('agent_tool_start', ctx, agent, tool, { toolCall });
                r.emit('agent_tool_end', ctx, agent, tool, 'sunny in SFO', { toolCall });
                r.emit('agent_end', ctx, agent, 'it is sunny');
            },
            { finalOutput: 'it is sunny' },
        );

        await runner.run(agent, 'weather in SFO?');

        const toolSpans = spansByName('openai_agents.tool');
        expect(toolSpans, 'expected one openai_agents.tool span').toHaveLength(1);

        const toolSpan = toolSpans[0];
        expect(toolSpan.attributes['span.type']).toBe('agentic.tool.invocation');
        expect(toolSpan.attributes['span.subtype']).toBe('content_generation');

        // Entity 1 is the tool, entity 2 the calling agent.
        expect(toolSpan.attributes['entity.1.type']).toBe('tool.openai_agents');
        expect(toolSpan.attributes['entity.1.name']).toBe('get_weather');
        expect(toolSpan.attributes['entity.1.description']).toBe('Get weather for a city');
        expect(toolSpan.attributes['entity.2.type']).toBe('agent.openai_agents');
        expect(toolSpan.attributes['entity.2.name']).toBe('Triage');

        const input = toolSpan.events.find((e: any) => e.name === 'data.input');
        expect(String(input!.attributes!.input)).toContain('SFO');
        const output = toolSpan.events.find((e: any) => e.name === 'data.output');
        expect(String(output!.attributes!.response)).toContain('sunny in SFO');

        const invocation = spansByName('openai_agents.agent')[0];
        expect(parentIdOf(toolSpan)).toBe(invocation.spanContext().spanId);
    });

    it('correlates interleaved parallel tool calls by callId', async () => {
        patchRunner();
        const agent = fakeAgent('Triage');
        const weather = fakeTool('get_weather', 'weather');
        const time = fakeTool('get_time', 'time');
        const weatherCall = { callId: 'call_w', name: 'get_weather', arguments: '{"city":"SFO"}' };
        const timeCall = { callId: 'call_t', name: 'get_time', arguments: '{"tz":"PST"}' };

        const runner = new FakeRunner(
            (r, ctx) => {
                r.emit('agent_start', ctx, agent, []);
                // Both start before either ends, completing FIFO. That ordering
                // is what discriminates: "most recent wins" bookkeeping would
                // hand the weather result to the time span, while LIFO
                // completion would pass even when broken.
                r.emit('agent_tool_start', ctx, agent, weather, { toolCall: weatherCall });
                r.emit('agent_tool_start', ctx, agent, time, { toolCall: timeCall });
                r.emit('agent_tool_end', ctx, agent, weather, 'sunny in SFO', { toolCall: weatherCall });
                r.emit('agent_tool_end', ctx, agent, time, '10:30 PST', { toolCall: timeCall });
                r.emit('agent_end', ctx, agent, 'done');
            },
            { finalOutput: 'done' },
        );

        await runner.run(agent, 'weather and time?');

        const toolSpans = spansByName('openai_agents.tool');
        expect(toolSpans).toHaveLength(2);

        const byName = (n: string) =>
            toolSpans.find((s) => s.attributes['entity.1.name'] === n)!;
        const weatherSpan = byName('get_weather');
        const timeSpan = byName('get_time');
        expect(weatherSpan, 'expected a get_weather tool span').toBeDefined();
        expect(timeSpan, 'expected a get_time tool span').toBeDefined();

        // Each result must land on its own call.
        const responseOf = (s: any) =>
            String(s.events.find((e: any) => e.name === 'data.output')!.attributes!.response);
        expect(responseOf(weatherSpan)).toContain('sunny in SFO');
        expect(responseOf(timeSpan)).toContain('10:30 PST');

        const inputOf = (s: any) =>
            String(s.events.find((e: any) => e.name === 'data.input')!.attributes!.input);
        expect(inputOf(weatherSpan)).toContain('SFO');
        expect(inputOf(timeSpan)).toContain('PST');
    });

    it('leaves no span unended when the run throws mid-flight', async () => {
        patchRunner();
        const agent = fakeAgent('Triage');
        const tool = fakeTool('get_weather', 'weather');
        const toolCall = { callId: 'call_1', name: 'get_weather', arguments: '{}' };

        const runner = new FakeRunner(
            (r, ctx) => {
                // Neither agent_end nor agent_tool_end arrives.
                r.emit('agent_start', ctx, agent, []);
                r.emit('agent_tool_start', ctx, agent, tool, { toolCall });
                throw new Error('model exploded');
            },
            null,
        );

        await expect(runner.run(agent, 'weather?')).rejects.toThrow('model exploded');

        // SimpleSpanProcessor only exports ended spans, so presence == ended.
        const invocations = spansByName('openai_agents.agent');
        const toolSpans = spansByName('openai_agents.tool');
        expect(invocations, 'invocation span must be force-closed').toHaveLength(1);
        expect(toolSpans, 'tool span must be force-closed').toHaveLength(1);

        // SpanStatusCode.ERROR === 2
        expect(invocations[0].status.code).toBe(2);
        expect(toolSpans[0].status.code).toBe(2);
        expect(spansByName('openai_agents.runner.run')).toHaveLength(1);
    });

    it('opens a turn scope, and a session scope only when the app supplies one', async () => {
        patchRunner();
        const agent = fakeAgent('Solo');
        const makeRunner = () =>
            new FakeRunner(
                (r, ctx) => {
                    r.emit('agent_start', ctx, agent, []);
                    r.emit('agent_end', ctx, agent, 'ok');
                },
                { finalOutput: 'ok' },
            );

        // Runner.run(agent, input, options): session rides on options.
        await makeRunner().run(agent, 'hello', { session: { sessionId: 'sess-abc' } });

        let turn = spansByName('openai_agents.runner.run')[0];
        expect(turn.attributes['scope.agentic.turn'], 'turn scope must be opened').toBeDefined();
        expect(turn.attributes['scope.agentic.session']).toBe('sess-abc');

        // Scopes propagate to bridge-created spans.
        const invocation = spansByName('openai_agents.agent')[0];
        expect(invocation.attributes['scope.agentic.session']).toBe('sess-abc');
        expect(invocation.attributes['scope.agentic.turn'])
            .toBe(turn.attributes['scope.agentic.turn']);

        // No session supplied: Monocle must not fabricate one.
        exporter.reset();
        await makeRunner().run(agent, 'hello again');
        turn = spansByName('openai_agents.runner.run')[0];
        expect(turn.attributes['scope.agentic.turn']).toBeDefined();
        expect(turn.attributes['scope.agentic.session']).toBeUndefined();
    });

    it('gives each agent activation its own invocation scope', async () => {
        patchRunner();
        const triage = fakeAgent('Triage');
        const billing = fakeAgent('Billing');
        const tool = fakeTool('lookup', 'lookup');
        const toolCall = { callId: 'call_1', name: 'lookup', arguments: '{}' };

        const runner = new FakeRunner(
            (r, ctx) => {
                r.emit('agent_start', ctx, triage, []);
                r.emit('agent_tool_start', ctx, triage, tool, { toolCall });
                r.emit('agent_tool_end', ctx, triage, tool, 'found', { toolCall });
                r.emit('agent_handoff', ctx, triage, billing);
                r.emit('agent_start', ctx, billing, []);
                r.emit('agent_end', ctx, billing, 'handled');
            },
            { finalOutput: 'handled' },
        );

        await runner.run(triage, 'billing question');

        const [first, second] = spansByName('openai_agents.agent');
        const firstScope = first.attributes['scope.agentic.invocation'];
        const secondScope = second.attributes['scope.agentic.invocation'];
        expect(firstScope, 'each activation needs an invocation scope').toBeDefined();
        expect(secondScope).toBeDefined();
        expect(secondScope, 'a delegated agent is a separate invocation')
            .not.toBe(firstScope);

        // A tool call carries its activation's scope rather than opening one.
        const toolSpan = spansByName('openai_agents.tool')[0];
        expect(toolSpan.attributes['scope.agentic.invocation']).toBe(firstScope);
    });

    it('collapses several Runner.run calls into one turn when the app opens a turn scope', async () => {
        patchRunner();
        const agent = fakeAgent('Solo');
        const makeRunner = () =>
            new FakeRunner(
                (r, ctx) => {
                    r.emit('agent_start', ctx, agent, []);
                    r.emit('agent_end', ctx, agent, 'ok');
                },
                { finalOutput: 'ok' },
            );

        // An app wrapping a multi-run workflow in its own agentic.turn scope
        // wants one turn, not one per Runner.run.
        await setScopesInternal({ 'agentic.turn': 'app-turn-1' }, null, async () => {
            await makeRunner().run(agent, 'first');
            await makeRunner().run(agent, 'second');
        });

        expect(
            spansByName('openai_agents.runner.run'),
            'the app-opened turn scope should suppress per-run turn spans',
        ).toHaveLength(0);

        // Activations still trace, under the app's turn.
        const invocations = spansByName('openai_agents.agent');
        expect(invocations).toHaveLength(2);
        for (const invocation of invocations) {
            expect(invocation.attributes['scope.agentic.turn']).toBe('app-turn-1');
        }
    });

    it('keeps concurrent runs on one shared Runner apart', async () => {
        patchRunner();
        const alpha = fakeAgent('Alpha');
        const beta = fakeAgent('Beta');

        // The module-level run() reuses a singleton Runner, so two in-flight
        // runs can share one emitter. Interleaved here so a bridge tracking a
        // single global "current run" would cross-attribute spans.
        const gate: Array<() => void> = [];
        const waitForGate = () => new Promise<void>((resolve) => gate.push(resolve));

        const runnerA = new FakeRunner(async (r, ctx) => {
            r.emit('agent_start', ctx, alpha, []);
            await waitForGate();
            r.emit('agent_end', ctx, alpha, 'alpha done');
        }, { finalOutput: 'alpha done' });

        const runnerB = new FakeRunner(async (r, ctx) => {
            r.emit('agent_start', ctx, beta, []);
            r.emit('agent_end', ctx, beta, 'beta done');
        }, { finalOutput: 'beta done' });

        const aPromise = runnerA.run(alpha, 'a');
        // Let A open its activation and park, then run B to completion inside it.
        await new Promise((r) => setTimeout(r, 5));
        await runnerB.run(beta, 'b');
        gate.forEach((release) => release());
        await aPromise;

        const invocations = spansByName('openai_agents.agent');
        expect(invocations).toHaveLength(2);

        const alphaSpan = invocations.find((s) => s.attributes['entity.1.name'] === 'Alpha')!;
        const betaSpan = invocations.find((s) => s.attributes['entity.1.name'] === 'Beta')!;
        expect(alphaSpan, 'expected an Alpha invocation span').toBeDefined();
        expect(betaSpan, 'expected a Beta invocation span').toBeDefined();

        // Each activation records its own output and nests under its own turn.
        const responseOf = (s: any) =>
            String(s.events.find((e: any) => e.name === 'data.output')!.attributes!.response);
        expect(responseOf(alphaSpan)).toContain('alpha done');
        expect(responseOf(betaSpan)).toContain('beta done');

        const turns = spansByName('openai_agents.runner.run');
        expect(turns).toHaveLength(2);
        expect(parentIdOf(alphaSpan)).not.toBe(parentIdOf(betaSpan));
    });

    it('parents the model-API inference span to the agent invocation that made it', async () => {
        patchRunner();
        patchOpenAIResponses();
        const agent = fakeAgent('Weather Assistant');

        const runner = new FakeRunner(
            async (r, ctx) => {
                r.emit('agent_start', ctx, agent, []);
                // Instrumented by the openai metamodel, not by this bridge.
                await new FakeResponses().create({ model: 'gpt-4o', input: 'weather?' });
                r.emit('agent_end', ctx, agent, 'It is sunny.');
            },
            { finalOutput: 'It is sunny.' },
        );

        await runner.run(agent, 'weather?');

        const inference = spansByName('openai_responses');
        expect(inference, 'expected the openai inference span').toHaveLength(1);

        const invocation = spansByName('openai_agents.agent')[0];
        // Without the pointer this parents to the turn span instead.
        expect(parentIdOf(inference[0])).toBe(invocation.spanContext().spanId);
        expect(inference[0].attributes['scope.agentic.invocation'])
            .toBe(invocation.attributes['scope.agentic.invocation']);
    });

    it('leaves a model-API call outside any agent run untouched', async () => {
        patchOpenAIResponses();

        await new FakeResponses().create({ model: 'gpt-4o', input: 'plain call' });

        const inference = spansByName('openai_responses')[0];
        expect(inference, 'expected the openai inference span').toBeDefined();
        // No agents run is live, so the pointer must not fire.
        expect(inference.attributes['scope.agentic.invocation']).toBeUndefined();
        expect(inference.attributes['span.type']).toBe('inference');
    });

    it('stops re-parenting once the invocation has closed', async () => {
        patchRunner();
        patchOpenAIResponses();
        const agent = fakeAgent('Solo');

        const runner = new FakeRunner(
            async (r, ctx) => {
                r.emit('agent_start', ctx, agent, []);
                r.emit('agent_end', ctx, agent, 'done');
                // The activation is over; must not attach to an ended span.
                await new FakeResponses().create({ model: 'gpt-4o', input: 'after' });
            },
            { finalOutput: 'done' },
        );

        await runner.run(agent, 'hello');

        const inference = spansByName('openai_responses')[0];
        const invocation = spansByName('openai_agents.agent')[0];
        const turn = spansByName('openai_agents.runner.run')[0];

        expect(parentIdOf(inference)).not.toBe(invocation.spanContext().spanId);
        expect(parentIdOf(inference)).toBe(turn.spanContext().spanId);
        expect(inference.attributes['scope.agentic.invocation']).toBeUndefined();
    });

    it('keeps sequential runs apart when the app reuses one RunContext', async () => {
        patchRunner();
        const agent = fakeAgent('Solo');
        const shared = fakeRunContext();
        const make = () =>
            new FakeRunner(
                (r, ctx) => {
                    r.emit('agent_start', ctx, agent, []);
                    r.emit('agent_end', ctx, agent, 'done');
                },
                { finalOutput: 'done' },
            );

        await make().run(agent, 'first', { context: shared });
        await make().run(agent, 'second', { context: shared });

        const turns = spansByName('openai_agents.runner.run');
        const invocations = spansByName('openai_agents.agent');
        expect(turns).toHaveLength(2);
        expect(invocations).toHaveLength(2);

        // Each activation belongs to its own turn: sharing a RunContext must not
        // make the second run attach to the first run's (already ended) turn.
        expect(invocations.map(parentIdOf).sort())
            .toEqual(turns.map((t) => t.spanContext().spanId).sort());
    });

    it('holds the turn span open until a streamed run finishes', async () => {
        patchStreamingRunner();
        const agent = fakeAgent('Solo');
        const tool = fakeTool('get_weather', 'weather');
        const toolCall = { callId: 'call_1', name: 'get_weather', arguments: '{}' };

        // Scoped to this run's trace: spans from earlier tests can still be
        // exported here, and picking one of those would compare unrelated clocks.
        let traceId: string | undefined;
        const runner = new FakeStreamingRunner(
            async (r, ctx) => {
                traceId = trace.getSpan(context.active())?.spanContext().traceId;
                r.emit('agent_start', ctx, agent, []);
                r.emit('agent_tool_start', ctx, agent, tool, { toolCall });
                r.emit('agent_tool_end', ctx, agent, tool, 'sunny', { toolCall });
                r.emit('agent_end', ctx, agent, 'it is sunny');
            },
            { finalOutput: 'it is sunny' },
        );

        const stream = await runner.run(agent, 'weather?', { stream: true });
        await stream.completed;
        await new Promise((r) => setTimeout(r, 20));

        const inThisRun = (x: any) => !traceId || x.spanContext().traceId === traceId;
        const turns = spansByName('openai_agents.runner.run').filter(inThisRun);
        expect(turns, 'expected one turn span').toHaveLength(1);

        // finalOutput only exists once the stream drains, so a span ended at
        // run() resolution records nothing.
        const out = turns[0].events.find((e: any) => e.name === 'data.output');
        expect(String(out!.attributes!.response)).toContain('it is sunny');

        // And the turn must end last. Asserted through export order, which
        // SimpleSpanProcessor emits on span end: comparing timestamps is unsound
        // here because OTel takes start times off a millisecond clock and end
        // times off the monotonic one.
        const order = exporter.getFinishedSpans().filter(inThisRun).map((x: any) => x.name);
        const invocation = spansByName('openai_agents.agent').filter(inThisRun)[0];
        expect(invocation, 'expected the invocation span').toBeDefined();
        expect(order.indexOf('openai_agents.agent'),
            `turn span must end after the activation it contains. order: ${order.join(' -> ')}`)
            .toBeLessThan(order.indexOf('openai_agents.runner.run'));
    });
});

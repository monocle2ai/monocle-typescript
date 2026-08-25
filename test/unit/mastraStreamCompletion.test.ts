import { describe, it, expect, vi } from 'vitest';
import { Context, SpanOptions, SpanStatusCode, Span, Tracer } from '@opentelemetry/api';
import { getPatchedMain } from '../../src/instrumentation/common/wrapper';

function makeMockSpan() {
    return {
        setAttribute: vi.fn(), addEvent: vi.fn(), updateName: vi.fn(),
        setStatus: vi.fn(), end: vi.fn(),
        spanContext: () => ({ traceId: 't', spanId: 's' }),
        resource: { attributes: { SERVICE_NAME: 'test-service' } },
        parentSpanContext: { spanId: 'parent' }, // non-empty → not a root span
        status: { code: SpanStatusCode.UNSET },
        isRecording: vi.fn(() => true),
    };
}

function makeTracer(span: any): Tracer {
    return {
        startActiveSpan: vi.fn((_name: string, fn: any) => fn(span)),
        startSpan: (_n: string, _o?: SpanOptions, _c?: Context): Span => { throw new Error('nope'); },
    } as unknown as Tracer;
}

describe('wrapper deferred completion (stream lifetime)', () => {
    it('returns the live streaming object immediately and ends the span only after completion', async () => {
        const span = makeMockSpan();
        let resolveFull: (v: any) => void;
        const fullOutput = new Promise((r) => { resolveFull = r; });
        const streamResult = { getFullOutput: () => fullOutput, textStream: {} };

        const processSpan = vi.fn();
        const handler: any = {
            skipSpan: () => false,
            preTracing: (_e: any, ctx: any) => ctx,
            setDefaultMonocleAttributes: vi.fn(),
            setWorkflowProperties: vi.fn(),
            postProcessSpan: vi.fn(),
            processSpan,
            resolveCompletion: ({ returnValue }: any) =>
                (returnValue && typeof returnValue.getFullOutput === 'function') ? returnValue.getFullOutput() : null,
        };

        const element: any = {
            package: '@mastra/core/agent', object: 'Agent', method: 'stream',
            spanName: 'mastra.agent.stream', tracer: makeTracer(span),
            spanHandler: handler, output_processor: [{ type: 'agentic.turn' }],
        };

        const patched = getPatchedMain(element);
        const original = function () { return streamResult; };
        const returned = (patched(original) as any).call({}, 'hello');

        // Caller gets the live streaming object synchronously.
        expect(returned).toBe(streamResult);
        // Span not ended yet — generation still "running".
        expect(span.end).not.toHaveBeenCalled();
        expect(processSpan).not.toHaveBeenCalled();

        // Finish generation.
        resolveFull!({ text: 'final answer' });
        await fullOutput;
        await Promise.resolve();

        // Now the output processor ran with the resolved FullOutput and the span ended.
        expect(processSpan).toHaveBeenCalled();
        const call = processSpan.mock.calls[0][0];
        expect(call.returnValue).toEqual({ text: 'final answer' });
        expect(span.end).toHaveBeenCalled();
    });

    // Real @mastra/core@1.x shape: stream() returns Promise<MastraModelOutput>.
    // The Promise branch must still resolve the deferred completion (getFullOutput)
    // instead of post-processing the un-consumed streaming object.
    it('resolves a Promise-wrapped streaming object via getFullOutput', async () => {
        const span = makeMockSpan();
        let resolveFull: (v: any) => void;
        const fullOutput = new Promise((r) => { resolveFull = r; });
        const streamResult = { getFullOutput: () => fullOutput, textStream: {} };

        const processSpan = vi.fn();
        const handler: any = {
            skipSpan: () => false,
            preTracing: (_e: any, ctx: any) => ctx,
            setDefaultMonocleAttributes: vi.fn(),
            setWorkflowProperties: vi.fn(),
            postProcessSpan: vi.fn(),
            processSpan,
            resolveCompletion: ({ returnValue }: any) =>
                (returnValue && typeof returnValue.getFullOutput === 'function') ? returnValue.getFullOutput() : null,
        };

        const element: any = {
            package: '@mastra/core/agent', object: 'Agent', method: 'stream',
            spanName: 'mastra.agent.stream', tracer: makeTracer(span),
            spanHandler: handler, output_processor: [{ type: 'agentic.turn' }],
        };

        const patched = getPatchedMain(element);
        // stream() returns a Promise that resolves to the streaming object.
        const original = function () { return Promise.resolve(streamResult); };
        const returned: any = (patched(original) as any).call({}, 'hello');

        // Caller gets a Promise resolving to the live streaming object.
        expect(typeof returned.then).toBe('function');
        expect(await returned).toBe(streamResult);

        // Output not processed until generation completes.
        expect(processSpan).not.toHaveBeenCalled();

        resolveFull!({ text: 'final answer' });
        await fullOutput;
        await Promise.resolve();
        await Promise.resolve();

        expect(processSpan).toHaveBeenCalled();
        expect(processSpan.mock.calls[0][0].returnValue).toEqual({ text: 'final answer' });
        expect(span.end).toHaveBeenCalled();
    });
});

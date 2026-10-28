import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { context, SpanStatusCode } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { setInstrumentor } from '../../src/instrumentation/common/utils';
import { traceMethod, monocleTraceMethod, monocleTrace } from '../../src/instrumentation/common/customSpans';

let provider: NodeTracerProvider;
let memExporter: InMemorySpanExporter;

beforeAll(() => { context.setGlobalContextManager(new AsyncHooksContextManager().enable()); });
afterAll(() => { context.disable(); });

beforeEach(() => {
    memExporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memExporter)] });
    const tracer = provider.getTracer('test');
    setInstrumentor({ getTracer: () => tracer });
});

afterEach(async () => {
    setInstrumentor(undefined);
    await provider.shutdown();
});

function spanNamed(name: string): ReadableSpan {
    const span = memExporter.getFinishedSpans().find(s => s.name === name);
    if (!span) throw new Error(`expected a span named ${name}`);
    return span;
}

function eventAttrs(span: ReadableSpan, name: string) {
    return span.events.find(e => e.name === name)?.attributes;
}

function parentId(span: ReadableSpan) {
    return (span as any).parentSpanContext?.spanId ?? (span as any).parentSpanId;
}

describe('traceMethod', () => {
    it('records a custom span with input and output', () => {
        const add = traceMethod((x: number, y: number) => x + y, { spanName: 'add' });

        expect(add(5, 10)).toBe(15);

        const span = spanNamed('add');
        expect(span.attributes['span.type']).toBe('custom');
        expect(eventAttrs(span, 'data.input')).toEqual({ input: '{"args":[5,10]}' });
        expect(eventAttrs(span, 'data.output')).toEqual({ response: '{"result":15}' });
    });

    it('does not log warnings for a normal call', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });

        traceMethod(() => 1, { spanName: 'quiet' })();
        monocleTrace('quiet.block', () => 1);

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('points span.source at the caller, not at monocle internals', async () => {
        await traceMethod(async () => 1, { spanName: 'sourced' })();
        await monocleTrace('sourced.block', async () => 1);

        for (const name of ['sourced', 'sourced.block']) {
            expect(String(spanNamed(name).attributes['span.source'])).toContain('customSpans.test.ts');
        }
    });

    it('names the span after the function, or custom_span when anonymous', () => {
        function settleInvoice() { return 1; }
        traceMethod(settleInvoice)();
        traceMethod((() => () => 2)())();

        expect(spanNamed(settleInvoice.name)).toBeDefined();
        expect(spanNamed('custom_span')).toBeDefined();
    });

    it('keeps the caller this', () => {
        const cart = { items: 3, count: traceMethod(function (this: any) { return this.items; }, { spanName: 'count' }) };

        expect(cart.count()).toBe(3);
    });

    it('passes exclude through to the processor', () => {
        traceMethod((card: string) => 'ok', { spanName: 'charge', exclude: 'inputs' })('4111');

        expect(eventAttrs(spanNamed('charge'), 'data.input')).toBeUndefined();
    });

    it('ends the span after an async generator is consumed and records the yielded items', async () => {
        const stream = traceMethod(async function* () { yield 'a'; yield 'b'; }, { spanName: 'stream' });

        const seen: string[] = [];
        for await (const item of stream()) {
            expect(memExporter.getFinishedSpans().some(s => s.name === 'stream')).toBe(false);
            seen.push(item);
        }

        expect(seen).toEqual(['a', 'b']);
        expect(eventAttrs(spanNamed('stream'), 'data.output')).toEqual({ response: '{"result":["a","b"]}' });
    });

    it('traces calls made after setup even when wrapped before it', () => {
        setInstrumentor(undefined);
        const early = traceMethod(() => 'ok', { spanName: 'early' });
        expect(early()).toBe('ok');
        expect(memExporter.getFinishedSpans()).toHaveLength(0);

        const tracer = provider.getTracer('test');
        setInstrumentor({ getTracer: () => tracer });
        early();

        expect(spanNamed('early')).toBeDefined();
    });
});

describe('monocleTraceMethod decorator', () => {
    class Orders {
        rate = 2;
        total(amount: number) { return amount * this.rate; }
    }

    it('wraps a method with legacy (experimentalDecorators) semantics', () => {
        class LegacyOrders extends Orders { }
        const descriptor = Object.getOwnPropertyDescriptor(Orders.prototype, 'total')!;
        const decorated = monocleTraceMethod()(LegacyOrders.prototype, 'total', descriptor);
        Object.defineProperty(LegacyOrders.prototype, 'total', decorated);

        expect(new LegacyOrders().total(4)).toBe(8);

        const span = spanNamed('total');
        expect(eventAttrs(span, 'data.input')).toEqual({ input: '{"args":[4]}' });
        expect(eventAttrs(span, 'data.output')).toEqual({ response: '{"result":8}' });
    });

    it('wraps a method with standard (TC39) decorator semantics', () => {
        const replacement = monocleTraceMethod({ spanName: 'orders.total' })(
            Orders.prototype.total,
            { kind: 'method', name: 'total' } as any,
        );

        expect(replacement.call(new Orders(), 5)).toBe(10);
        expect(spanNamed('orders.total')).toBeDefined();
    });
});

describe('public entry', () => {
    it('supports @monocleTraceMethod syntax on a class', async () => {
        const { monocleTraceMethod: decorator } = await import('../../src/index');
        class Payments {
            @decorator({ spanName: 'payments.refund' })
            refund(id: string) { return `refunded ${id}`; }
        }

        expect(new Payments().refund('r1')).toBe('refunded r1');
        expect(eventAttrs(spanNamed('payments.refund'), 'data.output')).toEqual({ response: '{"result":"refunded r1"}' });
    });
});

describe('monocleTrace', () => {
    it('wraps a block in a span with the given attributes and events', () => {
        const result = monocleTrace('checkout', () => 'done', {
            attributes: { 'cart.size': 3 },
            events: [{ name: 'note', attributes: { step: 'start' } }],
        });

        expect(result).toBe('done');
        const span = spanNamed('checkout');
        expect(span.attributes['cart.size']).toBe(3);
        expect(eventAttrs(span, 'note')).toEqual({ step: 'start' });
        expect(eventAttrs(span, 'data.input')).toBeUndefined();
    });

    it('parents spans created inside the block', async () => {
        const inner = traceMethod(async () => 1, { spanName: 'inner' });

        await monocleTrace('outer', async () => { await inner(); });

        expect(parentId(spanNamed('inner'))).toBe(spanNamed('outer').spanContext().spanId);
    });

    it('marks the span as an error and rethrows', async () => {
        await expect(monocleTrace('fails', async () => { throw new Error('nope'); })).rejects.toThrow('nope');

        expect(spanNamed('fails').status.code).toBe(SpanStatusCode.ERROR);
    });

    it('defaults the span name to custom_span', () => {
        monocleTrace(undefined, () => 1);

        expect(spanNamed('custom_span')).toBeDefined();
    });
});

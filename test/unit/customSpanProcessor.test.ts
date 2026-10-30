import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { context, SpanStatusCode } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { getPatchedMain } from '../../src/instrumentation/common/wrapper';
import {
    buildCustomSpanProcessor,
    serializeValue,
} from '../../src/instrumentation/common/customSpanProcessor';

describe('serializeValue', () => {
    it('keeps primitives and turns undefined into null', () => {
        expect(serializeValue(5)).toBe(5);
        expect(serializeValue('a')).toBe('a');
        expect(serializeValue(true)).toBe(true);
        expect(serializeValue(null)).toBe(null);
        expect(serializeValue(undefined)).toBe(null);
    });

    it('stringifies values JSON cannot hold', () => {
        expect(serializeValue(10n)).toBe('10');
        expect(serializeValue(function charge() { })).toBe('[Function charge]');
        expect(serializeValue(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
    });

    it('serializes class instances by their own fields', () => {
        class Order { constructor(public id = 7, public total = 9.5) { } }
        expect(serializeValue(new Order())).toEqual({ id: 7, total: 9.5 });
    });

    it('stops at depth 3 and caps collections at 100 items', () => {
        expect(serializeValue({ a: { b: { c: { d: 1 } } } })).toEqual({ a: { b: { c: '[object Object]' } } });
        expect(serializeValue(Array.from({ length: 150 }, (_, i) => i))).toHaveLength(100);
    });

    it('survives circular references', () => {
        const node: any = { name: 'root' };
        node.self = node;
        expect(() => JSON.stringify(serializeValue(node))).not.toThrow();
    });
});

describe('custom span processor (real spans)', () => {
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

    function trace(fn: Function, exclude?: any, spanName = 'orders.op') {
        const element = {
            tracer,
            package: 'app',
            object: 'Orders',
            method: 'op',
            spanName,
            output_processor: [buildCustomSpanProcessor(exclude)],
        };
        return getPatchedMain(element as any)(fn) as (...args: any[]) => any;
    }

    function customSpan(): ReadableSpan {
        const span = memExporter.getFinishedSpans().find(s => s.attributes['span.type'] === 'custom');
        if (!span) throw new Error('expected a custom span');
        return span;
    }

    function eventAttrs(span: ReadableSpan, name: string) {
        return span.events.find(e => e.name === name)?.attributes;
    }

    it('records args as data.input and the return value as data.output', () => {
        const add = trace((x: number, y: number) => x + y, undefined, 'add');

        expect(add(5, 10)).toBe(15);

        const span = customSpan();
        expect(span.name).toBe('add');
        expect(eventAttrs(span, 'data.input')).toEqual({ input: '{"args":[5,10]}' });
        expect(eventAttrs(span, 'data.output')).toEqual({ response: '{"result":15}' });
        expect(span.status.code).toBe(SpanStatusCode.OK);
    });

    it('records the resolved value of an async function', async () => {
        const greet = trace(async function greet(name: string) { return `Hi, ${name}!`; });

        await greet('Alice');

        expect(eventAttrs(customSpan(), 'data.output')).toEqual({ response: '{"result":"Hi, Alice!"}' });
    });

    it('records error_code without a response when a sync function throws', () => {
        const divide = trace(function divide() { throw new RangeError('divide by zero'); });

        expect(() => divide(10, 0)).toThrow('divide by zero');

        const span = customSpan();
        expect(eventAttrs(span, 'data.input')).toEqual({ input: '{"args":[10,0]}' });
        expect(eventAttrs(span, 'data.output')).toEqual({ error_code: 'error' });
        expect(span.status.code).toBe(SpanStatusCode.ERROR);
        expect(span.status.message).toBe('divide by zero');
    });

    it('uses the exception code as error_code when a rejection has one', async () => {
        const fetchOrder = trace(async function fetchOrder() {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        });

        await expect(fetchOrder()).rejects.toThrow('missing');

        const span = customSpan();
        expect(eventAttrs(span, 'data.output')).toEqual({ error_code: 'ENOENT' });
        expect(span.status.code).toBe(SpanStatusCode.ERROR);
    });

    it('drops data.input when inputs are excluded', () => {
        trace(function charge(card: string) { return 'ok'; }, 'inputs')('4111');

        const span = customSpan();
        expect(eventAttrs(span, 'data.input')).toBeUndefined();
        expect(eventAttrs(span, 'data.output')).toEqual({ response: '{"result":"ok"}' });
    });

    it('keeps error_code but drops the response when outputs are excluded', () => {
        const fail = trace(function fail() { throw new Error('boom'); }, ['outputs']);

        expect(() => fail()).toThrow();

        expect(eventAttrs(customSpan(), 'data.output')).toEqual({ error_code: 'error' });
    });

    it('accepts exclude names in any case and warns about unknown ones', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });

        trace(function both() { return 1; }, [' Inputs ', 'OUTPUTS', 'secrets'])();

        const span = customSpan();
        expect(eventAttrs(span, 'data.input')).toBeUndefined();
        expect(eventAttrs(span, 'data.output')).toEqual({});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('secrets'));
        warn.mockRestore();
    });
});

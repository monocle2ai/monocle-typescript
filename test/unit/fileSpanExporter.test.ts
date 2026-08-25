import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { context, trace } from '@opentelemetry/api';
import { FileSpanExporter } from '../../src/exporters/file/FileSpanExporter';

const TRACE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ROOT_SPAN = '1111111111111111';

function mkSpan(spanId: string, name: string, parentSpanId?: string, spanType = 'inference') {
    return {
        spanContext: () => ({ traceId: TRACE, spanId }),
        parentSpanId,
        attributes: { 'span.type': spanType },
        resource: { attributes: { 'service.name': 'weather-agent' } },
        name,
    };
}

const formatter = (s: any) => JSON.stringify({ name: s.name, spanId: s.spanContext().spanId });

function traceFiles(dir: string): string[] {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

function readTrace(dir: string, file: string) {
    const raw = readFileSync(join(dir, file), 'utf8');
    return { raw, parsed: JSON.parse(raw) as any[] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('FileSpanExporter — late spans on an already-ended trace', () => {
    let outPath: string;

    beforeEach(() => {
        outPath = mkdtempSync(join(tmpdir(), 'monocle-fse-'));
    });

    afterEach(() => {
        rmSync(outPath, { recursive: true, force: true });
    });

    // The Mastra weather-agent case: an async scorer's span arrives ~66ms after
    // the turn already completed.
    it('keeps a scorer span that arrives after the root in the same trace file', () => {
        const exporter: any = new FileSpanExporter({ outPath, serviceName: 'weather-agent', formatter });

        exporter.export(
            [
                mkSpan('2222222222222222', 'mastra.model.stream.toolcall', ROOT_SPAN),
                mkSpan('3333333333333333', 'mastra.model.stream.answer', ROOT_SPAN),
                mkSpan(ROOT_SPAN, 'mastra.agent.stream', undefined, 'workflow'),
            ],
            () => {},
        );

        exporter.export([mkSpan('4444444444444444', 'mastra.model.stream.scorer', ROOT_SPAN)], () => {});
        exporter.shutdown();

        const files = traceFiles(outPath);
        expect(files).toHaveLength(1);

        const { parsed } = readTrace(outPath, files[0]);
        expect(parsed.map((s) => s.spanId).sort()).toEqual([
            '1111111111111111',
            '2222222222222222',
            '3333333333333333',
            '4444444444444444',
        ]);
    });

    // The file must be readable the moment the trace ends. Waiting for the idle
    // window meant opening it right after a query showed a JSON syntax error.
    it('closes the file as soon as the root span is written', () => {
        const exporter: any = new FileSpanExporter({
            outPath,
            serviceName: 'weather-agent',
            formatter,
            idleTimeoutMs: 60_000, // must not be what saves us
        });

        exporter.export(
            [
                mkSpan('2222222222222222', 'mastra.model.stream.answer', ROOT_SPAN),
                mkSpan(ROOT_SPAN, 'mastra.agent.stream', undefined, 'workflow'),
            ],
            () => {},
        );

        // No sleep, no shutdown() — valid right now.
        const files = traceFiles(outPath);
        expect(files).toHaveLength(1);
        expect(readTrace(outPath, files[0]).parsed).toHaveLength(2);

        // A late scorer lands in that same file — and the file is valid again
        // straight away, without waiting for the idle window or shutdown().
        exporter.export([mkSpan('4444444444444444', 'mastra.model.stream.scorer', ROOT_SPAN)], () => {});

        expect(traceFiles(outPath)).toEqual(files);
        const { parsed } = readTrace(outPath, files[0]);
        expect(parsed).toHaveLength(3);
        expect(parsed.map((s) => s.spanId)).toContain('4444444444444444');

        exporter.shutdown();
        expect(readTrace(outPath, files[0]).parsed).toHaveLength(3); // no double-write
    });

    it('leaves valid JSON on disk once the trace goes idle', async () => {
        const exporter: any = new FileSpanExporter({
            outPath,
            serviceName: 'weather-agent',
            formatter,
            idleTimeoutMs: 50,
        });

        exporter.export([mkSpan(ROOT_SPAN, 'mastra.agent.stream', undefined, 'workflow')], () => {});
        await sleep(150);

        const files = traceFiles(outPath);
        expect(files).toHaveLength(1);
        // Must be parseable without shutdown() having run.
        expect(() => readTrace(outPath, files[0])).not.toThrow();
        expect(readTrace(outPath, files[0]).parsed).toHaveLength(1);
    });

    it('appends to the existing file when a span arrives after the trace was closed', async () => {
        const exporter: any = new FileSpanExporter({
            outPath,
            serviceName: 'weather-agent',
            formatter,
            idleTimeoutMs: 50,
        });

        exporter.export(
            [
                mkSpan('2222222222222222', 'mastra.model.stream.answer', ROOT_SPAN),
                mkSpan(ROOT_SPAN, 'mastra.agent.stream', undefined, 'workflow'),
            ],
            () => {},
        );
        await sleep(150); // trace closes

        const before = traceFiles(outPath);
        expect(before).toHaveLength(1);

        // A very late scorer span — the file is already closed and terminated with ']'.
        exporter.export([mkSpan('4444444444444444', 'mastra.model.stream.scorer', ROOT_SPAN)], () => {});
        exporter.shutdown();

        const after = traceFiles(outPath);
        expect(after).toEqual(before); // same single file, no second file
        const { parsed } = readTrace(outPath, after[0]);
        expect(parsed).toHaveLength(3);
        expect(parsed.map((s) => s.spanId)).toContain('4444444444444444');
    });

    it('never truncates an existing trace file', () => {
        const exporter: any = new FileSpanExporter({ outPath, serviceName: 'weather-agent', formatter });

        exporter.export([mkSpan(ROOT_SPAN, 'mastra.agent.stream', undefined, 'workflow')], () => {});
        exporter.export([mkSpan('4444444444444444', 'mastra.model.stream.scorer', ROOT_SPAN)], () => {});
        exporter.shutdown();

        const files = traceFiles(outPath);
        const total = files.reduce((n, f) => n + readTrace(outPath, f).parsed.length, 0);
        expect(total).toBe(2); // nothing lost
    });

    // Nothing calls shutdown() on exit and the idle timer is unref'd, so the
    // exporter must close its files on the way out.
    it('closes open trace files when the process exits', () => {
        const exporter: any = new FileSpanExporter({
            outPath,
            serviceName: 'weather-agent',
            formatter,
            idleTimeoutMs: 60_000, // long enough that only the exit hook can save us
        });

        const listenersBefore = process.listeners('exit').length;
        // A child span only — no root span, so nothing closes the file eagerly
        // and the exit hook is the only thing that can terminate it.
        exporter.export([mkSpan('2222222222222222', 'mastra.model.stream', ROOT_SPAN)], () => {});

        const added = process.listeners('exit').slice(listenersBefore);
        expect(added.length).toBeGreaterThan(0);

        const files = traceFiles(outPath);
        expect(files).toHaveLength(1);
        // Still open at this point — no ']' yet.
        expect(() => readTrace(outPath, files[0])).toThrow();

        // Simulate process exit.
        for (const fn of added) (fn as any)();

        expect(readTrace(outPath, files[0]).parsed).toHaveLength(1);
        exporter.shutdown(); // detaches the hook
    });

    // Writes use explicit byte offsets, so a string-length vs byte-length mix-up
    // would corrupt the file. LLM traces are full of non-ASCII text.
    it('writes correct offsets for multi-byte UTF-8 span content', () => {
        const exporter: any = new FileSpanExporter({ outPath, serviceName: 'weather-agent', formatter });

        const multibyte = [
            mkSpan('2222222222222222', '東京の天気を教えて', ROOT_SPAN),
            mkSpan('3333333333333333', 'Wetter in München ☀️🌧️', ROOT_SPAN),
            mkSpan('4444444444444444', 'Прогноз погоды — Москва', ROOT_SPAN),
            mkSpan(ROOT_SPAN, 'mastra.agent.stream', undefined, 'workflow'),
        ];
        exporter.export(multibyte, () => {});
        // Second batch forces an append after the offset has already advanced.
        exporter.export([mkSpan('5555555555555555', '🎉 scorer 完了', ROOT_SPAN)], () => {});
        exporter.shutdown();

        const files = traceFiles(outPath);
        expect(files).toHaveLength(1);
        const { parsed } = readTrace(outPath, files[0]);
        expect(parsed).toHaveLength(5);
        expect(parsed.map((s) => s.name)).toEqual([
            '東京の天気を教えて',
            'Wetter in München ☀️🌧️',
            'Прогноз погоды — Москва',
            'mastra.agent.stream',
            '🎉 scorer 完了',
        ]);
    });

    // Same check across a close/reopen boundary: the reopen seeks to size-1,
    // a byte offset.
    it('appends correctly after reopen when the file contains multi-byte text', async () => {
        const exporter: any = new FileSpanExporter({
            outPath,
            serviceName: 'weather-agent',
            formatter,
            idleTimeoutMs: 50,
        });

        exporter.export([mkSpan(ROOT_SPAN, '東京の天気 ☀️', undefined, 'workflow')], () => {});
        await sleep(150); // closes

        exporter.export([mkSpan('4444444444444444', 'Москва 🌧️', ROOT_SPAN)], () => {});
        exporter.shutdown();

        const files = traceFiles(outPath);
        expect(files).toHaveLength(1);
        const { parsed } = readTrace(outPath, files[0]);
        expect(parsed.map((s) => s.name)).toEqual(['東京の天気 ☀️', 'Москва 🌧️']);
    });

    // Spans further apart than the idle window close and reopen mid-trace and
    // must still land in one file — the slow-chain case, not scorer-specific.
    it('keeps a slow trace in one file across multiple idle closes', async () => {
        const exporter: any = new FileSpanExporter({
            outPath,
            serviceName: 'weather-agent',
            formatter,
            idleTimeoutMs: 40,
        });

        for (const [i, name] of ['step1', 'step2', 'step3'].entries()) {
            exporter.export([mkSpan(`${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`, name, ROOT_SPAN)], () => {});
            await sleep(120); // longer than the idle window
        }
        exporter.export([mkSpan(ROOT_SPAN, 'mastra.agent.stream', undefined, 'workflow')], () => {});
        exporter.shutdown();

        const files = traceFiles(outPath);
        expect(files).toHaveLength(1);
        const { parsed } = readTrace(outPath, files[0]);
        expect(parsed.map((s) => s.name)).toEqual(['step1', 'step2', 'step3', 'mastra.agent.stream']);
    });

    it('still separates distinct traces into distinct files', () => {
        const exporter: any = new FileSpanExporter({ outPath, serviceName: 'weather-agent', formatter });
        const other = {
            spanContext: () => ({ traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', spanId: '9999999999999999' }),
            parentSpanId: undefined,
            attributes: { 'span.type': 'workflow' },
            resource: { attributes: { 'service.name': 'weather-agent' } },
            name: 'other.trace',
        };

        exporter.export([mkSpan(ROOT_SPAN, 'mastra.agent.stream', undefined, 'workflow'), other], () => {});
        exporter.shutdown();

        expect(traceFiles(outPath)).toHaveLength(2);
    });
});

// Every instrumented library funnels through the same path: real SDK span ->
// exportInfo() -> FileSpanExporter. These use the default formatter and real
// OTel spans, so they generalise across frameworks rather than testing a stub.
describe('FileSpanExporter — real OTel spans through the default formatter', () => {
    let outPath: string;

    beforeEach(() => {
        outPath = mkdtempSync(join(tmpdir(), 'monocle-fse-real-'));
    });

    afterEach(() => {
        rmSync(outPath, { recursive: true, force: true });
    });

    function makeProvider(exporter: any) {
        return new NodeTracerProvider({
            resource: resourceFromAttributes({ 'service.name': 'weather-agent' }),
            spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
    }

    it('writes a real parent/child trace as one valid file', async () => {
        const exporter: any = new FileSpanExporter({ outPath, idleTimeoutMs: 50 });
        const provider = makeProvider(exporter);
        const tracer = provider.getTracer('test');

        const root = tracer.startSpan('mastra.agent.stream');
        root.setAttribute('span.type', 'workflow');
        const ctx = trace.setSpan(context.active(), root);
        const child = tracer.startSpan('mastra.model.stream', undefined, ctx);
        child.setAttribute('span.type', 'inference');
        child.end();
        root.end();

        // The async scorer: a real child of a root that has already ended.
        const scorer = tracer.startSpan('mastra.model.stream.scorer', undefined, ctx);
        scorer.setAttribute('span.type', 'inference');
        scorer.end();

        await provider.shutdown();

        const files = traceFiles(outPath);
        expect(files).toHaveLength(1);

        const { parsed } = readTrace(outPath, files[0]);
        expect(parsed).toHaveLength(3);
        // Real exportInfo shape, and all three share one trace id.
        const traceIds = new Set(parsed.map((s: any) => s.context.trace_id));
        expect(traceIds.size).toBe(1);
        expect(parsed.map((s: any) => s.name).sort()).toEqual([
            'mastra.agent.stream',
            'mastra.model.stream',
            'mastra.model.stream.scorer',
        ]);
        // The scorer really is parented to the already-ended root.
        const scorerOut = parsed.find((s: any) => s.name.endsWith('scorer'));
        const rootOut = parsed.find((s: any) => s.name === 'mastra.agent.stream');
        expect(scorerOut.parent_id).toBe(rootOut.context.span_id);
    });

    it('handles real spans carrying non-ASCII prompt attributes', async () => {
        const exporter: any = new FileSpanExporter({ outPath, idleTimeoutMs: 50 });
        const provider = makeProvider(exporter);
        const tracer = provider.getTracer('test');

        const root = tracer.startSpan('mastra.agent.stream');
        root.setAttribute('span.type', 'workflow');
        root.setAttribute('input', '東京の天気を教えて ☀️');
        root.setAttribute('output', 'Прогноз: 21°C — солнечно 🎉');
        root.end();

        await provider.shutdown();

        const files = traceFiles(outPath);
        const { parsed } = readTrace(outPath, files[0]);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].attributes.input).toBe('東京の天気を教えて ☀️');
        expect(parsed[0].attributes.output).toBe('Прогноз: 21°C — солнечно 🎉');
    });

    it('keeps two concurrent real traces in separate valid files', async () => {
        const exporter: any = new FileSpanExporter({ outPath, idleTimeoutMs: 50 });
        const provider = makeProvider(exporter);
        const tracer = provider.getTracer('test');

        // Interleave two independent traces the way concurrent requests would.
        const a = tracer.startSpan('trace.a.root');
        const b = tracer.startSpan('trace.b.root');
        const aChild = tracer.startSpan('trace.a.child', undefined, trace.setSpan(context.active(), a));
        const bChild = tracer.startSpan('trace.b.child', undefined, trace.setSpan(context.active(), b));
        aChild.end();
        bChild.end();
        a.end();
        b.end();

        await provider.shutdown();

        const files = traceFiles(outPath);
        expect(files).toHaveLength(2);
        for (const f of files) {
            const { parsed } = readTrace(outPath, f);
            expect(parsed).toHaveLength(2);
            expect(new Set(parsed.map((s: any) => s.context.trace_id)).size).toBe(1);
        }
    });
});

describe('FileSpanExporter — idle window vs batch flush interval', () => {
    let outPath: string;
    const origDelay = process.env.MONOCLE_EXPORTER_DELAY;
    const origIdle = process.env.MONOCLE_TRACE_IDLE_MS;

    beforeEach(() => {
        outPath = mkdtempSync(join(tmpdir(), 'monocle-fse-idle-'));
        delete process.env.MONOCLE_EXPORTER_DELAY;
        delete process.env.MONOCLE_TRACE_IDLE_MS;
    });

    afterEach(() => {
        rmSync(outPath, { recursive: true, force: true });
        if (origDelay === undefined) delete process.env.MONOCLE_EXPORTER_DELAY;
        else process.env.MONOCLE_EXPORTER_DELAY = origDelay;
        if (origIdle === undefined) delete process.env.MONOCLE_TRACE_IDLE_MS;
        else process.env.MONOCLE_TRACE_IDLE_MS = origIdle;
    });

    // If the idle window is <= the batch flush interval, a multi-batch trace
    // closes between batches and reopens on every one.
    it('defaults the idle window well above the default batch flush interval', () => {
        const exporter: any = new FileSpanExporter({ outPath });
        expect(exporter.idleTimeoutMs).toBeGreaterThanOrEqual(15_000);
        expect(exporter.idleTimeoutMs).toBeGreaterThan(5_000); // the batch default
    });

    it('scales the idle window when the batch flush interval is raised', () => {
        process.env.MONOCLE_EXPORTER_DELAY = '30000';
        const exporter: any = new FileSpanExporter({ outPath });
        expect(exporter.idleTimeoutMs).toBeGreaterThan(30_000);
    });

    it('lets MONOCLE_TRACE_IDLE_MS win when set explicitly', () => {
        process.env.MONOCLE_EXPORTER_DELAY = '30000';
        process.env.MONOCLE_TRACE_IDLE_MS = '2000';
        const exporter: any = new FileSpanExporter({ outPath });
        expect(exporter.idleTimeoutMs).toBe(2000);
    });
});

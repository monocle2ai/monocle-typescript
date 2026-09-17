import { describe, it, expect, beforeEach } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import {
    TraceReturnSpanExporter,
    getTraceReturnExporter,
    maybeTraceReturnProcessor,
} from "../../src/traceReturn/exporter";
import { encodeSpans, decodePayload } from "../../src/traceReturn/codec";

const SCOPE = "scope.monocle_trace_return";
const TRACE_A = "a".repeat(32);
const TRACE_B = "b".repeat(32);
const traceN = (n: number) => n.toString(16).padStart(32, "0");

function mkSpan(traceId: string, spanId: string, attributes: any = {}): any {
    return {
        name: "n",
        spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
        kind: SpanKind.INTERNAL,
        parentSpanContext: undefined,
        startTime: [1, 0],
        endTime: [2, 0],
        status: { code: 1, message: "OK" },
        attributes,
        events: [],
        links: [],
        resource: { attributes: { SERVICE_NAME: "s" } },
    };
}

let exporter: TraceReturnSpanExporter;
beforeEach(() => {
    exporter = new TraceReturnSpanExporter();
});

describe("scope filter", () => {
    it("keeps tagged spans and drops untagged ones from the same batch", () => {
        let result: any;
        exporter.export(
            [
                mkSpan(TRACE_A, "1".repeat(16), { [SCOPE]: "x" }),
                mkSpan(TRACE_A, "2".repeat(16), {}),
            ],
            (r) => { result = r; },
        );
        expect(result.code).toBe(ExportResultCode.SUCCESS);
        expect(exporter.popSpansForTrace(TRACE_A)).toHaveLength(1);
    });

    // The property that keeps a switched-off production process clean.
    it("buffers nothing at all when no span is tagged", () => {
        exporter.export([mkSpan(TRACE_A, "1".repeat(16), {})], () => { });
        expect(exporter.pendingTraceCount).toBe(0);
    });
});

describe("per-trace buffering", () => {
    it("segregates traces and evicts on pop", () => {
        exporter.export(
            [
                mkSpan(TRACE_A, "1".repeat(16), { [SCOPE]: "x" }),
                mkSpan(TRACE_B, "2".repeat(16), { [SCOPE]: "x" }),
            ],
            () => { },
        );
        expect(exporter.pendingTraceCount).toBe(2);
        expect(exporter.popSpansForTrace(TRACE_A)).toHaveLength(1);
        expect(exporter.pendingTraceCount).toBe(1);
        expect(exporter.popSpansForTrace(TRACE_A)).toEqual([]);
    });

    it("accumulates a trace across export batches", () => {
        exporter.export([mkSpan(TRACE_A, "1".repeat(16), { [SCOPE]: "x" })], () => { });
        exporter.export([mkSpan(TRACE_A, "2".repeat(16), { [SCOPE]: "x" })], () => { });
        expect(exporter.popSpansForTrace(TRACE_A)).toHaveLength(2);
    });

    it("caps pending traces FIFO rather than growing without bound", () => {
        for (let i = 0; i < 200; i++) {
            exporter.export([mkSpan(traceN(i), "1".repeat(16), { [SCOPE]: "x" })], () => { });
        }
        expect(exporter.pendingTraceCount).toBe(128);
        expect(exporter.popSpansForTrace(traceN(0))).toEqual([]);
        expect(exporter.popSpansForTrace(traceN(199))).toHaveLength(1);
    });
});

describe("lifecycle", () => {
    // Python's shutdown() exists purely to NOT do what the base class does.
    it("shutdown leaves an in-flight request's spans intact", async () => {
        exporter.export([mkSpan(TRACE_A, "1".repeat(16), { [SCOPE]: "x" })], () => { });
        await exporter.shutdown();
        expect(exporter.popSpansForTrace(TRACE_A)).toHaveLength(1);
    });

    it("the singleton lives on globalThis so ESM and CJS copies share it", () => {
        expect(getTraceReturnExporter()).toBe(getTraceReturnExporter());
        expect((globalThis as any)[Symbol.for("monocle2ai.traceReturnExporter")]).toBe(
            getTraceReturnExporter(),
        );
    });

    it("builds a processor only when the master switch is on", () => {
        delete process.env.MONOCLE_ENABLE_TRACE_RETURN;
        expect(maybeTraceReturnProcessor()).toBeNull();
        process.env.MONOCLE_ENABLE_TRACE_RETURN = "true";
        expect(maybeTraceReturnProcessor()).toBeInstanceOf(SimpleSpanProcessor);
        delete process.env.MONOCLE_ENABLE_TRACE_RETURN;
    });
});

// The reason the processor must be Simple: the response path pops without
// awaiting, so a span has to be claimable the instant it ends.
describe("against a real tracer provider", () => {
    it("makes a span poppable synchronously on end, and encodable", () => {
        const e = new TraceReturnSpanExporter();
        const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(e)] });
        const span = provider.getTracer("t").startSpan("agentic.turn", { kind: SpanKind.SERVER });
        span.setAttribute(SCOPE, "1");
        const traceId = span.spanContext().traceId;

        expect(e.popSpansForTrace(traceId)).toEqual([]);

        span.end();
        const popped = e.popSpansForTrace(traceId);
        expect(popped).toHaveLength(1);
        expect(JSON.parse(decodePayload(encodeSpans(popped)))[0].kind).toBe("SpanKind.SERVER");
    });
});

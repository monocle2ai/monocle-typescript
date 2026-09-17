import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import {
    ReadableSpan,
    SimpleSpanProcessor,
    SpanExporter,
    SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { consoleLog } from "../common/logging";
import { TRACE_RETURN_SCOPE_ATTRIBUTE } from "./constants";
import { isTraceReturnEnabled } from "./gate";

// In-memory buffer holding only spans tagged with the trace-return scope, keyed
// by trace id so a response can claim exactly its own request's spans.
//
// No locking, unlike Python's threading.Lock: Node's event loop is single
// threaded and neither export() nor popSpansForTrace() awaits, so a pop can
// never interleave with an export.

// Bound on how many un-popped traces we hold. Divergence from Python, which is
// unbounded: a tagged request whose response path never pops (handler crashed,
// socket died mid-flight) would otherwise leak its spans for the life of the
// process. Only authorized requests ever buffer, so this is a backstop, not a
// hot path.
const MAX_PENDING_TRACES = 128;

export class TraceReturnSpanExporter implements SpanExporter {
    private buffer = new Map<string, ReadableSpan[]>();

    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        for (const span of spans) {
            // The scope only lands on spans created inside an authorized request
            // (spanHandler.setMonocleAttributes writes it from baggage), so a
            // production process with the switch off accumulates nothing.
            if (span.attributes?.[TRACE_RETURN_SCOPE_ATTRIBUTE] == null) continue;

            const traceId = span.spanContext().traceId;
            const existing = this.buffer.get(traceId);
            if (existing) {
                existing.push(span);
                continue;
            }
            if (this.buffer.size >= MAX_PENDING_TRACES) {
                // Map preserves insertion order, so the first key is the oldest trace.
                const oldest = this.buffer.keys().next().value as string;
                this.buffer.delete(oldest);
                consoleLog(`[monocle] trace-return buffer full, evicted trace ${oldest}`);
            }
            this.buffer.set(traceId, [span]);
        }
        resultCallback({ code: ExportResultCode.SUCCESS });
    }

    // Returns and evicts this trace's spans. Empty array, never undefined — the
    // response path treats "no spans" as "send the body unchanged".
    popSpansForTrace(traceId: string): ReadableSpan[] {
        const spans = this.buffer.get(traceId);
        if (!spans) return [];
        this.buffer.delete(traceId);
        return spans;
    }

    // Deliberately a no-op, for the same reason Python's resets _stopped rather
    // than calling super(): this is a process-global singleton reachable from the
    // tracer provider, so any provider teardown propagates shutdown() to it.
    // Clearing the buffer here would drop the spans of a request that is still
    // mid-flight, and permanently disabling the exporter would kill the feature
    // for the rest of the process.
    shutdown(): Promise<void> {
        return Promise.resolve();
    }

    forceFlush(): Promise<void> {
        return Promise.resolve();
    }

    get pendingTraceCount(): number {
        return this.buffer.size;
    }

    clearForTests(): void {
        this.buffer.clear();
    }
}

// On globalThis for the same reason as INSTRUMENTOR_KEY in
// instrumentation/common/utils.ts: `--import monocle2ai/register` loads the ESM
// build while a later require("monocle2ai") loads the CJS build, and each copy
// has its own module state. The middleware must reach the very same exporter the
// tracer provider was built with, or it pops from an empty buffer.
const TRACE_RETURN_EXPORTER_KEY = Symbol.for("monocle2ai.traceReturnExporter");

export function getTraceReturnExporter(): TraceReturnSpanExporter {
    const g = globalThis as any;
    if (!g[TRACE_RETURN_EXPORTER_KEY]) {
        g[TRACE_RETURN_EXPORTER_KEY] = new TraceReturnSpanExporter();
    }
    return g[TRACE_RETURN_EXPORTER_KEY];
}

// Simple, never Batch: popSpansForTrace() runs on the response path and cannot
// await a flush, so onEnd has to hand the span over synchronously.
export function maybeTraceReturnProcessor(): SpanProcessor | null {
    if (!isTraceReturnEnabled()) return null;
    return new SimpleSpanProcessor(getTraceReturnExporter());
}

import { describe, it, expect, beforeAll } from "vitest";
import { trace } from "@opentelemetry/api";
import { SpanProcessor } from "@opentelemetry/sdk-trace-node";

// Supplying our own processor means addSpanProcessors() is skipped, which is
// exactly the path that would miss trace return if it were registered in there.
const noop: SpanProcessor = {
    onStart() { }, onEnd() { },
    shutdown() { return Promise.resolve(); },
    forceFlush() { return Promise.resolve(); },
};

describe("setupMonocle wiring", () => {
    let setScopes: any, startTrace: any, getTraceReturnExporter: any, codec: any;

    beforeAll(async () => {
        // Before the dynamic imports: the provider latches this at construction.
        process.env.MONOCLE_ENABLE_TRACE_RETURN = "true";
        const monocle = await import("../../src/index");
        ({ setScopes, startTrace } = monocle);
        ({ getTraceReturnExporter } = await import("../../src/traceReturn/exporter"));
        codec = await import("../../src/traceReturn/codec");
        monocle.setupMonocle("trace-return-demo", [noop]);
    });

    it("turns scoped work into a payload the Python loader can read", () => {
        let traceId = "";
        setScopes({ monocle_trace_return: "1" }, () => {
            startTrace(() => {
                traceId = trace.getActiveSpan()!.spanContext().traceId;
            });
        });

        const spans = getTraceReturnExporter().popSpansForTrace(traceId);
        expect(spans.length).toBeGreaterThan(0);

        // Simulate what the middleware will do in step 8.
        const delim = codec.makeDelimiter();
        const body = Buffer.from('{"answer":"42"}', "utf8");
        const wire = Buffer.concat([body, codec.buildTrailerBytes(spans, delim)]);

        const { clean, payload } = codec.splitBodyAndTrailer(wire, delim);
        expect(clean.toString()).toBe('{"answer":"42"}');

        const decoded = JSON.parse(codec.decodePayload(payload));
        expect(decoded[0].attributes["scope.monocle_trace_return"]).toBe("1");
        expect(decoded[0].attributes["span.type"]).toBe("workflow");
        expect(decoded[0].kind).toBe("SpanKind.INTERNAL");
    });

    it("leaves untagged work out of the buffer entirely", () => {
        let traceId = "";
        startTrace(() => { traceId = trace.getActiveSpan()!.spanContext().traceId; });
        expect(getTraceReturnExporter().popSpansForTrace(traceId)).toEqual([]);
    });
});

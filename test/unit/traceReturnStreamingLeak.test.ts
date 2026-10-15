import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "http";
import { SpanProcessor } from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

// Trace return buffers every span of an AUTHORIZED request until the response
// path pops them. On a buffered response that always happens, because res.end
// always runs. A stream is different: an SSE response the client walks away
// from never reaches res.end, so nothing ever pops - and the spans sit in the
// exporter until MAX_PENDING_TRACES evicts them.
//
// That was an acknowledged edge case ("crashed handler, dead socket") when
// every response was buffered. With streaming it is the ordinary way an SSE
// request ends, so it needs an explicit drain rather than an eviction policy.

const finished: ReadableSpan[] = [];
const collector: SpanProcessor = {
    onStart() { },
    onEnd(span) { finished.push(span); },
    shutdown() { return Promise.resolve(); },
    forceFlush() { return Promise.resolve(); },
};

const KEY = "leak-test-key";
let port = 0;
let server: any;
let exporter: any;

function abortedStreamRequest(): Promise<void> {
    return new Promise<void>((resolve) => {
        const req = http.request(
            {
                host: "127.0.0.1", port, path: "/sse", method: "GET",
                headers: { "x-monocle-retrieve-traces": KEY },
            },
            (res) => { res.on("data", () => req.destroy()); },
        );
        req.on("error", () => { });
        req.on("close", () => resolve());
        req.end();
    });
}

beforeAll(async () => {
    process.env.MONOCLE_ENABLE_TRACE_RETURN = "true";
    process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY = KEY;

    const monocle = await import("../../src/index");
    monocle.setupMonocle("trace-return-leak-demo", [collector]);
    exporter = (await import("../../src/traceReturn/exporter")).getTraceReturnExporter();

    server = http.createServer((req, res) => {
        if (req.url === "/sse") {
            res.setHeader("content-type", "text/event-stream");
            res.write("data: hello\n\n");
            return; // never ends: the client hangs up instead
        }
        res.setHeader("content-type", "application/json");
        res.end('{"ok":true}');
    });
    server.listen(0);
    await new Promise((r) => server.once("listening", r));
    port = server.address().port;
});

afterAll(() => server?.close());

describe("an authorized stream the client abandons", () => {
    it("does not leave its spans buffered in the exporter", async () => {
        exporter.clearForTests();
        expect(exporter.pendingTraceCount).toBe(0);

        await abortedStreamRequest();
        await new Promise((r) => setTimeout(r, 250));

        expect(
            exporter.pendingTraceCount,
            "spans of an abandoned stream were buffered with nothing left to pop them",
        ).toBe(0);
    });

    it("does not accumulate across many abandoned streams", async () => {
        exporter.clearForTests();

        for (let i = 0; i < 5; i++) await abortedStreamRequest();
        await new Promise((r) => setTimeout(r, 400));

        expect(exporter.pendingTraceCount).toBe(0);
    });
});

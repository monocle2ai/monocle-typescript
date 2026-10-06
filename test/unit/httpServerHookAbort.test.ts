import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "http";
import { SpanProcessor } from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

const finished: ReadableSpan[] = [];
const collector: SpanProcessor = {
    onStart() { },
    onEnd(span) { finished.push(span); },
    shutdown() { return Promise.resolve(); },
    forceFlush() { return Promise.resolve(); },
};

let port = 0;
let server: any;

function outputAttributes(span: ReadableSpan): Record<string, any> {
    return (span.events.find((e) => e.name === "data.output")?.attributes ?? {}) as any;
}

// Asks for a path and hangs up without waiting for the server to finish.
// onFirstByte runs when the first body byte arrives, which is the only moment a
// streaming client can distinguish from a server that has sent nothing.
function abortDuring(path: string, waitForBytes: boolean): Promise<void> {
    return new Promise<void>((resolve) => {
        const req = http.request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
            if (waitForBytes) res.on("data", () => req.destroy());
        });
        // req.destroy() with no error argument emits "close", not "error".
        req.on("error", () => { });
        req.on("close", () => resolve());
        req.end();
        // Nothing will ever arrive on the silent route, so the abort is timed.
        if (!waitForBytes) setTimeout(() => req.destroy(), 150);
    });
}

async function settle(): Promise<void> {
    // The close event is asynchronous; give the server a tick to observe it.
    await new Promise((r) => setTimeout(r, 200));
}

beforeAll(async () => {
    process.env.MONOCLE_ENABLE_TRACE_RETURN = "true";
    const monocle = await import("../../src/index");
    monocle.setupMonocle("http-abort-demo", [collector]);

    const express = (await import("express")).default;
    const app = express();
    // Writes headers and a body chunk, then never ends: the client aborts while
    // the handler hangs. This is the shape of every SSE endpoint.
    app.get("/hang", (_req: any, res: any) => {
        res.write("partial");
    });
    // Never writes anything at all. Indistinguishable from the above at the
    // transport layer EXCEPT that no byte was ever produced, which is the whole
    // basis of the status rule being tested here.
    app.get("/silent", (_req: any, _res: any) => { });

    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    port = server.address().port;
});

afterAll(() => server?.close());

describe("client abort on a response that streamed", () => {
    let httpSpan: ReadableSpan;

    beforeAll(async () => {
        finished.length = 0;
        await abortDuring("/hang", true);
        await settle();
        httpSpan = finished.find((s) => s.attributes["span.type"] === "http.process")!;
    });

    it("still ends the span rather than losing the request", () => {
        expect(httpSpan).toBeDefined();
    });

    // The behaviour this whole change exists for. A client closing a stream it
    // was reading is how a healthy SSE response ends, so it must not be an
    // error - previously this asserted ERROR / "client disconnected".
    it("does not call it an error", () => {
        expect(httpSpan.status.code).not.toBe(2);
    });

    it("records why it ended, so a real abort is still findable", () => {
        expect(outputAttributes(httpSpan).end_reason).toBe("client_closed");
    });

    it("counts the bytes that did reach the client", () => {
        expect(outputAttributes(httpSpan).chunk_count).toBe(1);
    });

    it("ends the workflow span too, so the trace is not left open", () => {
        expect(finished.find((s) => s.attributes["span.type"] === "workflow")).toBeDefined();
    });
});

describe("client abort before a single byte was written", () => {
    let httpSpan: ReadableSpan;

    beforeAll(async () => {
        finished.length = 0;
        await abortDuring("/silent", false);
        await settle();
        httpSpan = finished.find((s) => s.attributes["span.type"] === "http.process")!;
    });

    // Unchanged, and deliberately so: nothing was ever sent, so either the
    // client gave up before a response or the handler hung. That is a failure,
    // and narrowing the error case must not swallow it.
    it("is still an error", () => {
        expect(httpSpan).toBeDefined();
        expect(httpSpan.status.code).toBe(2); // SpanStatusCode.ERROR
        expect(httpSpan.status.message).toBe("client disconnected");
    });

    it("carries none of the stream attributes, having never streamed", () => {
        const out = outputAttributes(httpSpan);
        expect(out.end_reason).toBeUndefined();
        expect(out.chunk_count).toBeUndefined();
        expect(out.time_to_first_byte_ms).toBeUndefined();
    });
});

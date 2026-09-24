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

beforeAll(async () => {
    process.env.MONOCLE_ENABLE_TRACE_RETURN = "true";
    const monocle = await import("../../src/index");
    monocle.setupMonocle("http-abort-demo", [collector]);

    const express = (await import("express")).default;
    const app = express();
    // Writes headers, then never ends: the client aborts while the handler hangs.
    app.get("/hang", (_req: any, res: any) => {
        res.write("partial");
    });

    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    port = server.address().port;
});

afterAll(() => server?.close());

describe("client abort", () => {
    it("ends the http.process span instead of losing the request", async () => {
        finished.length = 0;

        await new Promise<void>((resolve) => {
            const req = http.request({ host: "127.0.0.1", port, path: "/hang", method: "GET" }, (res) => {
                res.on("data", () => req.destroy());
            });
            // req.destroy() with no error argument emits "close", not "error".
            req.on("error", () => { });
            req.on("close", () => resolve());
            req.end();
        });

        // The close event is asynchronous; give the server a tick to observe it.
        await new Promise((r) => setTimeout(r, 200));

        const httpSpan = finished.find((s) => s.attributes["span.type"] === "http.process");
        expect(httpSpan).toBeDefined();
        expect(httpSpan!.status.code).toBe(2); // SpanStatusCode.ERROR
        expect(httpSpan!.status.message).toBe("client disconnected");
    });

    it("ends the workflow span too, so the trace is not left open", () => {
        expect(finished.find((s) => s.attributes["span.type"] === "workflow")).toBeDefined();
    });
});

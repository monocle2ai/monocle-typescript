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

function get(path: string) {
    return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({
                status: res.statusCode!,
                body: Buffer.concat(chunks).toString(),
                headers: res.headers,
            }));
        });
        req.on("error", reject);
        req.end();
    });
}

beforeAll(async () => {
    // The point of this file: trace return is OFF.
    delete process.env.MONOCLE_ENABLE_TRACE_RETURN;
    const monocle = await import("../../src/index");
    monocle.setupMonocle("http-spans-no-trace-return", [collector]);

    const express = (await import("express")).default;
    const app = express();
    app.get("/ping", (_req: any, res: any) => res.json({ ok: true }));
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    port = server.address().port;
});

afterAll(() => server?.close());

describe("http spans without trace return", () => {
    beforeAll(async () => {
        finished.length = 0;
        await get("/ping");
    });

    it("emits an http.process span", () => {
        const span = finished.find((s) => s.attributes["span.type"] === "http.process");
        expect(span).toBeDefined();
        expect(span!.attributes["entity.1.method"]).toBe("GET");
        expect(span!.attributes["entity.1.route"]).toBe("/ping");
    });

    it("emits the workflow span above it", () => {
        const httpSpan = finished.find((s) => s.attributes["span.type"] === "http.process")!;
        const workflow = finished.find((s) => s.attributes["span.type"] === "workflow")!;
        expect(workflow).toBeDefined();
        expect(httpSpan.parentSpanContext?.spanId).toBe(workflow.spanContext().spanId);
    });

    it("tags nothing with the trace-return scope", () => {
        for (const span of finished) {
            expect(span.attributes["scope.monocle_trace_return"]).toBeUndefined();
        }
    });

    it("adds no trace-return response header", async () => {
        const { TRACE_RETURN_RESPONSE_HEADER } = await import("../../src/traceReturn/constants");
        const res = await get("/ping");
        expect(res.status).toBe(200);
        expect(res.headers[TRACE_RETURN_RESPONSE_HEADER.toLowerCase()]).toBeUndefined();
    });

    it("leaves the trace-return exporter buffer empty", async () => {
        const { getTraceReturnExporter } = await import("../../src/traceReturn/exporter");
        expect(getTraceReturnExporter().pendingTraceCount).toBe(0);
    });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "http";
import { gzipSync } from "zlib";
import { SpanProcessor } from "@opentelemetry/sdk-trace-node";

const noop: SpanProcessor = {
    onStart() { }, onEnd() { },
    shutdown() { return Promise.resolve(); }, forceFlush() { return Promise.resolve(); },
};
const KEY = "test-key";
let port = 0, server: any, codec: any, exporter: any;

// Raw socket read, not fetch(): fetch transparently decodes content-encoding,
// which would hide exactly the bug this file exists to catch.
function raw(path: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; headers: any; body: Buffer }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
                resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject);
        req.end();
    });
}

function split(r: any) {
    const delim = codec.parseDelimiterFromHeader(r.headers["x-monocle-traces"] ?? "");
    if (!delim) return { delim: null, clean: r.body, spans: null };
    const { clean, payload } = codec.splitBodyAndTrailer(r.body, delim);
    return { delim, clean, spans: payload ? JSON.parse(codec.decodePayload(payload)) : null };
}

beforeAll(async () => {
    process.env.MONOCLE_ENABLE_TRACE_RETURN = "true";
    process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY = KEY;
    const monocle = await import("../../src/index");
    monocle.setupMonocle("http-hook-demo", [noop]);
    codec = await import("../../src/traceReturn/codec");
    exporter = (await import("../../src/traceReturn/exporter")).getTraceReturnExporter();
    const { getPatchedMain } = await import("../../src/instrumentation/common/wrapper");
    const { getInstrumentor } = await import("../../src/instrumentation/common/utils");

    const agent = getPatchedMain({
        tracer: getInstrumentor().getTracer(),
        package: "@langchain/core", object: "Runnable", method: "invoke",
        spanName: "langchain.invoke",
    })(async function work() { return "42"; });

    const express = (await import("express")).default;
    const app = express();

    // Stands in for `compression`: patches res.write/end AFTER our hook — the
    // ordering that breaks a naive implementation — and honours accept-encoding
    // exactly as the real package does.
    app.use((req: any, res: any, next: any) => {
        if (!req.headers["accept-encoding"]?.includes("gzip")) return next();
        const chunks: Buffer[] = [];
        const origWrite = res.write.bind(res), origEnd = res.end.bind(res);
        res.write = (c: any) => { chunks.push(Buffer.from(c)); return true; };
        res.end = (c?: any) => {
            if (c) chunks.push(Buffer.from(c));
            res.setHeader("content-encoding", "gzip");
            res.removeHeader("content-length");
            origWrite(gzipSync(Buffer.concat(chunks)));
            return origEnd();
        };
        next();
    });

    app.get("/chat", async (_req: any, res: any) => { res.json({ answer: await agent.call({}) }); });
    app.get("/plain", (_req: any, res: any) => { res.send("hello"); });
    app.get("/stream", async (_req: any, res: any) => {
        await agent.call({});
        res.write("chunk1|"); res.write("chunk2|"); res.end("done");
    });

    await new Promise<void>((r) => { server = app.listen(0, () => { port = server.address().port; r(); }); });
});

afterAll(() => server?.close());

describe("untouched paths", () => {
    // Each of these also asserts the exporter buffer stays empty. Without the
    // scope an unauthorized request buffers spans nothing ever pops, and the
    // absent response header alone would not catch it.
    it("a request without the header gets a normal response", async () => {
        const r = await raw("/chat");
        expect(r.headers["x-monocle-traces"]).toBeUndefined();
        expect(JSON.parse(r.body.toString())).toEqual({ answer: "42" });
        expect(exporter.pendingTraceCount).toBe(0);
    });

    it("a request with the wrong key gets a normal response", async () => {
        const r = await raw("/chat", { "x-monocle-retrieve-traces": "nope" });
        expect(r.headers["x-monocle-traces"]).toBeUndefined();
        expect(JSON.parse(r.body.toString())).toEqual({ answer: "42" });
        expect(exporter.pendingTraceCount).toBe(0);
    });

    it("a normal client still gets its response compressed", async () => {
        const r = await raw("/chat", { "accept-encoding": "gzip" });
        expect(r.headers["content-encoding"]).toBe("gzip");
        expect(exporter.pendingTraceCount).toBe(0);
    });
});

describe("authorized requests", () => {
    it("carries the whole trace back with the body intact", async () => {
        const r = await raw("/chat", { "x-monocle-retrieve-traces": KEY });
        const { delim, clean, spans } = split(r);

        expect(delim).toMatch(/^__MONOCLE_TRACES__[0-9a-f]{32}__$/);
        expect(JSON.parse(clean.toString())).toEqual({ answer: "42" });
        // Dropped, or the client would truncate at the original body length.
        expect(r.headers["content-length"]).toBeUndefined();

        expect(spans.map((s: any) => s.name).sort())
            .toEqual(["GET /chat", "langchain.invoke", "workflow"]);
        // The request's own root span is in its own payload.
        expect(spans.find((s: any) => s.name === "GET /chat").kind).toBe("SpanKind.SERVER");
        expect(new Set(spans.map((s: any) => s.context.trace_id)).size).toBe(1);
    });

    // The reason the accept-encoding strip exists.
    it("defeats a compression middleware layered above the hook", async () => {
        const r = await raw("/chat", { "x-monocle-retrieve-traces": KEY, "accept-encoding": "gzip" });
        expect(r.headers["content-encoding"]).toBeUndefined();
        const { clean, spans } = split(r);
        expect(JSON.parse(clean.toString())).toEqual({ answer: "42" });
        expect(spans).toHaveLength(3);
    });

    it("appends after a streamed body without buffering it", async () => {
        const r = await raw("/stream", { "x-monocle-retrieve-traces": KEY });
        const { clean, spans } = split(r);
        expect(clean.toString()).toBe("chunk1|chunk2|done");
        expect(spans).toHaveLength(3);
    });

    // The hook opens workflow + http.process for every request, so even a route
    // that triggers no instrumented call returns that pair.
    it("returns the request's own span pair for a route that traces nothing", async () => {
        const r = await raw("/plain", { "x-monocle-retrieve-traces": KEY });
        const { clean, spans } = split(r);
        expect(clean.toString()).toBe("hello");
        expect(spans.map((s: any) => s.name).sort()).toEqual(["GET /plain", "workflow"]);
    });
});

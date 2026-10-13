import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "http";
import * as net from "net";
import { SpanProcessor } from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

// The spec's "Unit, real server" case: a plain http.createServer on an
// ephemeral port, driven over a real socket. The two createServer uses in
// httpServerHook.test.ts inject a fake res and never touch a socket, so
// nothing in the suite could see what the hook does to response framing.

const finished: ReadableSpan[] = [];
const collector: SpanProcessor = {
    onStart() { },
    onEnd(span) { finished.push(span); },
    shutdown() { return Promise.resolve(); },
    forceFlush() { return Promise.resolve(); },
};

const KEY = "framing-key";
const BODY = "hello world";
let port = 0;
let server: any;
let codec: any;
let exporter: any;

// Reads the bytes off the wire rather than through http.request, which
// de-chunks transparently and would hide the framing under test.
function wire(path: string, headers: Record<string, string> = {}, version = "1.1") {
    return new Promise<{ head: string; body: Buffer }>((resolve, reject) => {
        const socket = net.createConnection(port, "127.0.0.1", () => {
            const lines = [
                `GET ${path} HTTP/${version}`,
                `Host: 127.0.0.1:${port}`,
                ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
                "Connection: close",
                "",
                "",
            ];
            socket.write(lines.join("\r\n"));
        });
        const chunks: Buffer[] = [];
        socket.on("data", (c) => chunks.push(c));
        socket.on("error", reject);
        socket.on("end", () => {
            const all = Buffer.concat(chunks);
            const sep = all.indexOf("\r\n\r\n");
            resolve({ head: all.subarray(0, sep).toString("latin1"), body: all.subarray(sep + 4) });
        });
    });
}

function request(path: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>(
        (resolve, reject) => {
            const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve({
                    status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks),
                }));
            });
            req.on("error", reject);
            req.end();
        },
    );
}

beforeAll(async () => {
    process.env.MONOCLE_ENABLE_TRACE_RETURN = "true";
    process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY = KEY;
    const monocle = await import("../../src/index");
    monocle.setupMonocle("http-framing-demo", [collector]);
    codec = await import("../../src/traceReturn/codec");
    exporter = (await import("../../src/traceReturn/exporter")).getTraceReturnExporter();

    // No framework at all: whatever framing Node picks is the framing the
    // application chose, and the hook must not change it.
    server = http.createServer((req, res) => {
        if (req.url?.startsWith("/streamed")) {
            res.write("part1|");
            res.end("part2");
            return;
        }
        res.end(BODY);
    });
    server.listen(0);
    await new Promise((r) => server.once("listening", r));
    port = server.address().port;
});

afterAll(() => server?.close());

describe("response framing on a plain http server", () => {
    it("keeps the Content-Length Node computes for res.end(body)", async () => {
        finished.length = 0;
        const res = await wire("/plain");
        expect(res.head).toMatch(/^content-length: 11$/im);
        expect(res.head).not.toMatch(/transfer-encoding/i);
        expect(res.body.toString()).toBe(BODY);
    });

    it("traces that request all the same", () => {
        const span = finished.find((s) => s.attributes["span.type"] === "http.process")!;
        expect(span).toBeDefined();
        expect(span.name).toBe("GET /plain");
        expect(span.events.find((e) => e.name === "data.output")!.attributes!.response).toBe(BODY);
    });

    // Node close-delimits for HTTP/1.0 rather than sending a length, so what
    // matters here is that the body is not chunk-framed: a 1.0 client, or a
    // proxy speaking 1.0 downstream, cannot parse that framing at all.
    it("sends an HTTP/1.0 client an unframed body", async () => {
        const res = await wire("/plain", {}, "1.0");
        expect(res.head).not.toMatch(/transfer-encoding/i);
        expect(res.body.toString()).toBe(BODY);
    });

    // A handler that writes before ending was already chunked without us.
    it("leaves an explicitly streamed response chunked", async () => {
        const res = await request("/streamed");
        expect(res.headers["transfer-encoding"]).toBe("chunked");
        expect(res.body.toString()).toBe("part1|part2");
    });

    it("adds no trace-return header to an ordinary request", async () => {
        const res = await request("/plain");
        expect(res.headers["x-monocle-traces"]).toBeUndefined();
        expect(exporter.pendingTraceCount).toBe(0);
    });
});

// The one case that legitimately needs chunked: the trailer is appended after
// the body, so a declared Content-Length would truncate it at the client.
describe("response framing when a trailer is appended", () => {
    it("switches to chunked and returns the spans after the body", async () => {
        const res = await request("/plain", { "x-monocle-retrieve-traces": KEY });
        expect(res.headers["content-length"]).toBeUndefined();
        expect(res.headers["transfer-encoding"]).toBe("chunked");

        const delim = codec.parseDelimiterFromHeader(res.headers["x-monocle-traces"] ?? "");
        expect(delim).toMatch(/^__MONOCLE_TRACES__[0-9a-f]{32}__$/);
        const { clean, payload } = codec.splitBodyAndTrailer(res.body, delim);
        expect(clean.toString()).toBe(BODY);
        const spans = JSON.parse(codec.decodePayload(payload));
        expect(spans.map((s: any) => s.name).sort()).toEqual(["GET /plain", "workflow"]);
    });
});

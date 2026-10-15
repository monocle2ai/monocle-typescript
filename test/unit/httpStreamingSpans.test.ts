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

const SLOW_FIRST_BYTE_MS = 120;

function outputAttributes(span: ReadableSpan): Record<string, any> {
    return (span.events.find((e) => e.name === "data.output")?.attributes ?? {}) as any;
}

function get(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks).toString()));
        });
        req.on("error", reject);
        req.end();
    });
}

// Reads the http.process span for one request made in isolation.
async function spanFor(path: string): Promise<ReadableSpan> {
    finished.length = 0;
    await get(path);
    await new Promise((r) => setTimeout(r, 50));
    const span = finished.find((s) => s.attributes["span.type"] === "http.process");
    expect(span, `no http.process span for ${path}`).toBeDefined();
    return span!;
}

// spanFor() waits for a clean response; a torn-down one never delivers "end",
// so this drives the request and waits for the socket to die instead.
async function spanForBrokenStream(path: string): Promise<ReadableSpan> {
    finished.length = 0;
    await new Promise<void>((resolve) => {
        const req = http.request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
            res.on("data", () => { });
            res.on("close", () => resolve());
        });
        req.on("error", () => resolve());
        req.end();
    });
    await new Promise((r) => setTimeout(r, 150));
    const span = finished.find((s) => s.attributes["span.type"] === "http.process");
    expect(span, `no http.process span for ${path}`).toBeDefined();
    return span!;
}

beforeAll(async () => {
    const monocle = await import("../../src/index");
    monocle.setupMonocle("http-streaming-demo", [collector]);

    // Plain node:http rather than express: the hook patches the server
    // prototype, so this exercises the same path with nothing in between that
    // could buffer writes and change the chunk count being asserted.
    server = http.createServer((req, res) => {
        if (req.url === "/sse") {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write("data: one\n\n");
            res.write("data: two\n\n");
            res.end();
            return;
        }
        if (req.url === "/slow") {
            res.writeHead(200, { "content-type": "text/event-stream" });
            setTimeout(() => {
                res.write("data: late\n\n");
                res.end();
            }, SLOW_FIRST_BYTE_MS);
            return;
        }
        if (req.url === "/binary") {
            // setHeader, not writeHead: writeHead(status, headers) writes the
            // header block straight to the socket, and res.getHeader() never
            // sees those values - so isTextualResponse would read an empty
            // content-type and capture these bytes as text.
            res.setHeader("content-type", "application/octet-stream");
            res.statusCode = 200;
            res.write(Buffer.from([1, 2, 3]));
            res.end(Buffer.from([4, 5]));
            return;
        }
        if (req.url === "/explode") {
            // Starts streaming, then the response is torn down by a server-side
            // failure rather than by the client going away.
            res.setHeader("content-type", "text/event-stream");
            res.write("data: partial\n\n");
            setTimeout(() => res.destroy(new Error("agent exploded")), 20);
            return;
        }
        if (req.url === "/typed") {
            // Writes plain Uint8Arrays, which is what a Web ReadableStream
            // yields and therefore what every Next.js streaming route handler
            // ends up writing to the socket.
            res.setHeader("content-type", "text/event-stream");
            const enc = new TextEncoder();
            res.write(enc.encode("data: one\n\n"));
            res.end(enc.encode("data: two\n\n"));
            return;
        }
        if (req.url === "/plain") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        res.writeHead(404);
        res.end();
    });
    server.listen(0);
    await new Promise((r) => server.once("listening", r));
    port = server.address().port;
});

afterAll(() => server?.close());

describe("a streamed response that the server finishes", () => {
    let out: Record<string, any>;
    let span: ReadableSpan;

    beforeAll(async () => {
        span = await spanFor("/sse");
        out = outputAttributes(span);
    });

    it("counts one chunk per write", () => {
        // Two res.write() calls; the res.end() carried no chunk.
        expect(out.chunk_count).toBe(2);
    });

    it("says the server ended it, not the client", () => {
        expect(out.end_reason).toBe("complete");
    });

    it("is a success", () => {
        expect(span.status.code).not.toBe(2);
    });

    it("reports a numeric time to first byte", () => {
        expect(typeof out.time_to_first_byte_ms).toBe("number");
        expect(out.time_to_first_byte_ms).toBeGreaterThan(0);
    });

    it("still captures the body", () => {
        expect(out.response).toContain("data: one");
    });
});

// Without this the attribute could be a constant and every test above would
// still pass. A route that deliberately stalls before its first write is the
// cheapest way to prove the number tracks reality.
describe("time to first byte", () => {
    it("measures the delay before the first write, not the whole request", async () => {
        const out = outputAttributes(await spanFor("/slow"));
        expect(out.time_to_first_byte_ms).toBeGreaterThan(SLOW_FIRST_BYTE_MS * 0.75);
    });

    it("stays well below the delay for a response that writes immediately", async () => {
        const out = outputAttributes(await spanFor("/sse"));
        expect(out.time_to_first_byte_ms).toBeLessThan(SLOW_FIRST_BYTE_MS * 0.75);
    });
});

// appendResponseChunk returns early for a non-textual response, so counting
// chunks inside it would have lost the shape of every streamed download.
describe("a streamed response whose body is not captured", () => {
    let out: Record<string, any>;

    beforeAll(async () => {
        out = outputAttributes(await spanFor("/binary"));
    });

    it("declines to capture the body", () => {
        expect(out.response).toBeUndefined();
    });

    it("counts its chunks anyway, including the one passed to res.end", () => {
        expect(out.chunk_count).toBe(2);
    });

    it("still reports how it ended", () => {
        expect(out.end_reason).toBe("complete");
    });
});

// The no-regression property: an ordinary response must look exactly as it did
// before streaming was addressed at all.
describe("an ordinary non-streamed response", () => {
    let out: Record<string, any>;

    beforeAll(async () => {
        out = outputAttributes(await spanFor("/plain"));
    });

    it("carries none of the three stream attributes", () => {
        expect(out.chunk_count).toBeUndefined();
        expect(out.end_reason).toBeUndefined();
        expect(out.time_to_first_byte_ms).toBeUndefined();
    });

    it("is otherwise unchanged", () => {
        expect(out.status_code).toBe("200");
        expect(out.response).toBe('{"ok":true}');
    });
});

// A stream torn down by the server is NOT the same as a client hanging up, and
// res.errored is what tells them apart: Node sets it only in the former case.
// Without this distinction every server-side streaming failure would be
// recorded as a healthy client_closed, which is the one way the "a disconnect
// is not an error" rule could hide a real fault.
describe("a streamed response the server tears down", () => {
    let span: ReadableSpan;
    let out: Record<string, any>;

    beforeAll(async () => {
        span = await spanForBrokenStream("/explode");
        out = outputAttributes(span);
    });

    it("is an error, unlike a client disconnect", () => {
        expect(span.status.code).toBe(2); // SpanStatusCode.ERROR
    });

    it("says what went wrong", () => {
        expect(span.status.message).toContain("agent exploded");
    });

    it("reports end_reason=error rather than client_closed", () => {
        expect(out.end_reason).toBe("error");
    });

    it("still reports the stream shape it managed before failing", () => {
        expect(out.chunk_count).toBe(1);
        expect(typeof out.time_to_first_byte_ms).toBe("number");
    });
});

// A Web ReadableStream yields Uint8Array, not Buffer, and Buffer.isBuffer() is
// false for one. Without handling it the body silently comes back empty for
// every framework that streams through a Web Response - Next.js route handlers
// above all. The chunk counter uses ArrayBuffer.isView and always worked, so
// the two disagreed: chunk_count 3 next to an empty response.
describe("a stream written as Uint8Array rather than Buffer", () => {
    let out: Record<string, any>;

    beforeAll(async () => {
        out = outputAttributes(await spanFor("/typed"));
    });

    it("captures the body", () => {
        expect(out.response).toContain("data: one");
        expect(out.response).toContain("data: two");
    });

    it("does not render the bytes as numbers", () => {
        // Uint8Array.toString() gives "100,97,116,97..." - decoding has to go
        // through a Buffer view, not the array's own toString.
        expect(out.response).not.toMatch(/^\d+,\d+/);
    });

    it("counts the chunks as it would for a Buffer", () => {
        expect(out.chunk_count).toBe(2);
    });
});

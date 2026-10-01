import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as os from "os";
import * as path from "path";
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
let staticDir = "";
let lastHealthRes: any = null;

function post(path: string, body: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
            { host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json" } },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
            },
        );
        req.on("error", reject);
        req.end(body);
    });
}

function get(path: string, headers: Record<string, string> = {}) {
    return getOn(port, path, headers);
}

function getOn(targetPort: number, path: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: targetPort, path, method: "GET", headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
        });
        req.on("error", reject);
        req.end();
    });
}

// Sends a raw request line rather than going through http.request, which
// always emits the origin-form target. This is the only way to reproduce the
// absolute-form request target (RFC 9112 §3.2.2) that Node passes through
// as req.url unchanged.
function rawRequest(requestTarget: string, body: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(port, "127.0.0.1", () => {
            const lines = [
                `POST ${requestTarget} HTTP/1.1`,
                `Host: 127.0.0.1:${port}`,
                "Content-Type: application/json",
                `Content-Length: ${Buffer.byteLength(body)}`,
                "Connection: close",
                "",
                body,
            ];
            socket.write(lines.join("\r\n"));
        });
        let data = "";
        socket.on("data", (c) => { data += c.toString(); });
        socket.on("error", reject);
        socket.on("end", () => {
            const [head, ...rest] = data.split("\r\n\r\n");
            const status = parseInt(head.split(" ")[1], 10);
            resolve({ status, body: rest.join("\r\n\r\n") });
        });
    });
}

beforeAll(async () => {
    process.env.MONOCLE_ENABLE_TRACE_RETURN = "true";
    const monocle = await import("../../src/index");
    monocle.setupMonocle("http-span-demo", [collector]);

    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());
    const router = express.Router();
    router.post("/v1/ask", (req: any, res: any) => {
        res.json({ answer: `You asked: ${req.body.question}` });
    });
    router.get("/users/:id", (req: any, res: any) => {
        res.json({ id: req.params.id });
    });
    app.use("/api", router);
    app.post("/health", (_req: any, res: any) => {
        lastHealthRes = res;
        res.json({ ok: true });
    });

    // Outside the repo: a served-by-middleware path, where no req.route exists
    // and Express has rewritten req.url to the mount-relative "/app.js".
    staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "monocle-static-"));
    fs.writeFileSync(path.join(staticDir, "app.js"), "console.log('hi');\n");
    app.use("/static", express.static(staticDir));

    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    port = server.address().port;
});

afterAll(() => {
    server?.close();
    if (staticDir) fs.rmSync(staticDir, { recursive: true, force: true });
});

function spanNamed(type: string) {
    return finished.find((s) => s.attributes["span.type"] === type);
}

describe("http server hook", () => {
    beforeAll(async () => {
        finished.length = 0;
        await post("/api/v1/ask?lang=en", JSON.stringify({ question: "What is Task Decomposition?" }));
    });

    it("emits an http.process span", () => {
        expect(spanNamed("http.process")).toBeDefined();
    });

    it("puts the workflow span above it, so attributes land at entity.1", () => {
        const httpSpan = spanNamed("http.process")!;
        const workflow = spanNamed("workflow")!;
        expect(httpSpan.parentSpanContext?.spanId).toBe(workflow.spanContext().spanId);
        expect(workflow.parentSpanContext?.spanId).toBeUndefined();
        expect(httpSpan.attributes["entity.1.method"]).toBe("POST");
    });

    it("captures the route template, not the concrete path", () => {
        expect(spanNamed("http.process")!.attributes["entity.1.route"]).toBe("/api/v1/ask");
    });

    it("captures request and response bodies through the real Express stack", () => {
        const httpSpan = spanNamed("http.process")!;
        const input = httpSpan.events.find((e) => e.name === "data.input")!;
        const output = httpSpan.events.find((e) => e.name === "data.output")!;
        expect(input.attributes!.request_body).toBe('{"question":"What is Task Decomposition?"}');
        expect(input.attributes!.params).toBe("lang=en");
        expect(output.attributes!.status_code).toBe("200");
        expect(output.attributes!.response).toContain("You asked:");
    });

    it("names the span by method and route", () => {
        expect(spanNamed("http.process")!.name).toBe("POST /api/v1/ask");
    });

    // Express rewrites req.url to the mount-relative "/v1/ask" for the duration
    // of the router's dispatch, and res.end runs inside it. A url naming a path
    // this server would 404 on is worse than no url at all.
    it("records the original request target in entity.1.url, mount prefix included", () => {
        expect(spanNamed("http.process")!.attributes["entity.1.url"])
            .toBe(`http://127.0.0.1:${port}/api/v1/ask?lang=en`);
    });

    it("uses SpanKind.SERVER", () => {
        expect(spanNamed("http.process")!.kind).toBe(1); // SpanKind.SERVER
    });

    it("serves the response unchanged", async () => {
        const res = await post("/api/v1/ask", JSON.stringify({ question: "ping" }));
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ answer: "You asked: ping" });
    });
});

// The name is chosen at request start, before Express has matched a route, so
// it only becomes the template when finish() renames the span.
describe("parameterised routes", () => {
    beforeAll(async () => {
        finished.length = 0;
        await get("/api/users/12345");
    });

    it("names the span by the route template, not the concrete path", () => {
        expect(spanNamed("http.process")!.name).toBe("GET /api/users/:id");
    });

    it("records the same template in entity.1.route", () => {
        expect(spanNamed("http.process")!.attributes["entity.1.route"]).toBe("/api/users/:id");
    });
});

// Served by middleware rather than a matched route: req.route is never set, so
// the route and the span name fall back to req.url - which express.static's
// mount has already rewritten to "/app.js". All three attributes lost the prefix.
describe("a path served by mounted middleware", () => {
    beforeAll(async () => {
        finished.length = 0;
        await get("/static/app.js");
    });

    it("keeps the mount prefix in the route and the span name", () => {
        const span = spanNamed("http.process")!;
        expect(span.attributes["entity.1.route"]).toBe("/static/app.js");
        expect(span.name).toBe("GET /static/app.js");
    });

    it("keeps it in entity.1.url too", () => {
        expect(spanNamed("http.process")!.attributes["entity.1.url"])
            .toBe(`http://127.0.0.1:${port}/static/app.js`);
    });
});

// Fix 2: Monocle scopes are server-side state. getScopesInternal() copies every
// monocle.scope.* baggage entry onto every span, so an extracted one would let
// an unauthenticated caller forge monocle_trace_return and fill the exporter
// buffer with spans no response ever pops.
describe("client-forged scopes", () => {
    let exporter: any;
    let restore: any;

    beforeAll(async () => {
        const { propagation } = await import("@opentelemetry/api");
        const { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } =
            await import("@opentelemetry/core");
        exporter = (await import("../../src/traceReturn/exporter")).getTraceReturnExporter();

        // The api default propagator is a no-op, so nothing would be extracted and
        // the test would pass without the fix. Real apps register one of these via
        // @opentelemetry/sdk-node; that is the exposed configuration.
        restore = propagation;
        propagation.setGlobalPropagator(new CompositePropagator({
            propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
        }));

        finished.length = 0;
        exporter.clearForTests();
        await get("/api/users/7", { baggage: "monocle.scope.monocle_trace_return=pwn,monocle.scope.tenant=acme" });
    });

    afterAll(() => restore?.disable());

    // Neither scope exists anywhere on this server, so both arrived in the
    // header and both must go. The server-owned case is the describe below.
    it("keeps the forged scope off the spans", () => {
        const httpSpan = spanNamed("http.process")!;
        const workflow = spanNamed("workflow")!;
        expect(httpSpan.attributes["scope.monocle_trace_return"]).toBeUndefined();
        expect(httpSpan.attributes["scope.tenant"]).toBeUndefined();
        expect(workflow.attributes["scope.monocle_trace_return"]).toBeUndefined();
    });

    it("leaves nothing buffered for a response that will never pop it", () => {
        expect(exporter.pendingTraceCount).toBe(0);
    });
});

// The other half of the strip: with no global propagator registered — the
// default — propagation.extract is a no-op, so the baggage it returns IS the
// server's own. Dropping every monocle.scope.* entry there silently deletes
// the application's ambient scopes from every span in the request.
describe("server-owned ambient scopes", () => {
    let ambientPort = 0;
    let ambientServer: any;

    beforeAll(async () => {
        const { context } = await import("@opentelemetry/api");
        const { updateBaggageContextWithScopes } =
            await import("../../src/instrumentation/common/utils");
        const express = (await import("express")).default;
        const app = express();
        app.get("/ping", (_req: any, res: any) => res.json({ ok: true }));

        // listen() inside the scope: the server's async context is what every
        // request handler inherits, which is how an app sets a process-wide scope.
        const scoped = updateBaggageContextWithScopes(context.active(), { tenant: "acme" });
        await context.with(scoped, async () => {
            ambientServer = app.listen(0);
            await new Promise((r) => ambientServer.once("listening", r));
        });
        ambientPort = ambientServer.address().port;

        finished.length = 0;
        await getOn(ambientPort, "/ping");
    });

    afterAll(() => ambientServer?.close());

    it("survives onto both spans of the request", () => {
        expect(spanNamed("http.process")!.attributes["scope.tenant"]).toBe("acme");
        expect(spanNamed("workflow")!.attributes["scope.tenant"]).toBe("acme");
    });

    it("is not overwritten by a client sending the same scope name", async () => {
        const { propagation } = await import("@opentelemetry/api");
        const { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } =
            await import("@opentelemetry/core");
        propagation.setGlobalPropagator(new CompositePropagator({
            propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
        }));
        try {
            finished.length = 0;
            await getOn(ambientPort, "/ping", { baggage: "monocle.scope.tenant=evil" });
            expect(spanNamed("http.process")!.attributes["scope.tenant"]).toBe("acme");
        } finally {
            propagation.disable();
        }
    });
});

// Fix 1: the hook's try must cover startRequest only. Wrapping the passthrough
// too makes a synchronously throwing handler run a second time from the catch.
// Driven through emit() directly: over a real socket the re-dispatched throw
// escapes uncaught and the client hangs, which is the bug, not a usable assertion.
describe("a handler that throws synchronously", () => {
    function fakeExchange() {
        const res: any = {
            statusCode: 200, headersSent: false,
            setHeader() { }, getHeader() { return undefined; }, removeHeader() { },
            writeHead() { return res; }, write() { return true; }, end() { return res; },
        };
        return { req: { method: "GET", url: "/boom", headers: {} } as any, res };
    }

    it("is invoked exactly once", () => {
        let invocations = 0;
        const server = http.createServer(() => {
            invocations++;
            throw new Error("boom");
        });
        const { req, res } = fakeExchange();

        // The handler's throw propagates out of emit, as it does unpatched.
        expect(() => server.emit("request", req, res)).toThrow("boom");
        expect(invocations).toBe(1);
        server.close();
    });

    it("still instrumented the request that threw", () => {
        const server = http.createServer(() => { throw new Error("boom"); });
        const { req, res } = fakeExchange();
        const originalEnd = res.end;
        expect(() => server.emit("request", req, res)).toThrow("boom");

        // The response patches went on before the handler ran, so the throw
        // escaped from inside the span context rather than bypassing the hook.
        expect(res.end).not.toBe(originalEnd);
        server.close();
    });
});

// withExclusion mirrors excludePaths.test.ts's withEnv: it resets the module's
// cache on both sides so the setting never leaks into another test in this
// worker, and restores whatever value (or absence) was there before.
async function withExclusion(value: string, fn: () => Promise<void>): Promise<void> {
    const previous = process.env.MONOCLE_HTTP_EXCLUDE_PATHS;
    process.env.MONOCLE_HTTP_EXCLUDE_PATHS = value;
    const { resetExcludedPathsForTests } = await import("../../src/instrumentation/http/excludePaths");
    resetExcludedPathsForTests();
    try {
        await fn();
    } finally {
        if (previous === undefined) delete process.env.MONOCLE_HTTP_EXCLUDE_PATHS;
        else process.env.MONOCLE_HTTP_EXCLUDE_PATHS = previous;
        resetExcludedPathsForTests();
    }
}

function noSpansEmitted() {
    expect(finished.filter((s) => s.attributes["span.type"] === "http.process")).toHaveLength(0);
    expect(finished.filter((s) => s.attributes["span.type"] === "workflow")).toHaveLength(0);
}

// The whole claim of exclusion is "nothing happened": no spans AND no
// response patches. lastHealthRes is set by the /health handler itself, so
// this reads the exact ServerResponse instance the hook would have patched.
function noHookInvolvement() {
    noSpansEmitted();
    expect(lastHealthRes).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(lastHealthRes, "end")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(lastHealthRes, "write")).toBe(false);
}

describe("excluded paths", () => {
    it("emits no spans, leaves res.end unpatched, and still serves the request", async () => {
        await withExclusion("/health", async () => {
            finished.length = 0;
            lastHealthRes = null;
            const res = await post("/health", "{}");
            // A bail-out that still broke the response would pass
            // noHookInvolvement() below but fail these two assertions.
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ ok: true });
            noHookInvolvement();
        });
    });
});

// Each case reproduces a bypass a reviewer verified against this exact test
// app: case-insensitive Express routing, and the absolute-form request target
// Node passes straight through to req.url. Both must go through the real
// hook, not just the predicate, since the bug was in the wiring, not the match.
describe("excluded paths — bypass resistance", () => {
    it("excludes a case-variant of the configured path", async () => {
        await withExclusion("/health", async () => {
            finished.length = 0;
            lastHealthRes = null;
            const res = await post("/Health", "{}");
            expect(res.status).toBe(200);
            noHookInvolvement();
        });
    });

    it("excludes an absolute-form request target", async () => {
        await withExclusion("/health", async () => {
            finished.length = 0;
            lastHealthRes = null;
            const res = await rawRequest(`http://127.0.0.1:${port}/health`, "{}");
            expect(res.status).toBe(200);
            noHookInvolvement();
        });
    });
});

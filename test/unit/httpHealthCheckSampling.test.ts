import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as http from "http";
import { TraceFlags } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { resetHealthCheckStateForTests } from "../../src/instrumentation/http/healthCheck";

const exported: ReadableSpan[] = [];
// A real SimpleSpanProcessor, not a hand-rolled one: suppression works by
// clearing the SAMPLED flag, and only the SDK's own processors check it. A raw
// { onEnd(span) { push(span) } } would see every span and prove nothing.
const collector = new SimpleSpanProcessor({
    export(spans, cb) { spans.forEach((s) => exported.push(s)); cb({ code: ExportResultCode.SUCCESS }); },
    shutdown() { return Promise.resolve(); },
    forceFlush() { return Promise.resolve(); },
});

let port = 0;
let server: any;
const RETRIEVAL_KEY = "health-sampling-key";

function get(path: string, headers: Record<string, string> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks).toString()));
        });
        req.on("error", reject);
        req.end();
    });
}

function named(type: string): ReadableSpan[] {
    return exported.filter((s) => s.attributes["span.type"] === type);
}

const settle = () => new Promise((r) => setTimeout(r, 100));

beforeAll(async () => {
    process.env.MONOCLE_HEALTH_CHECK_SAMPLE_RATE = "5";
    // Trace return on, so the last test can show a sampled-out probe sends no
    // trailer. Must precede setupMonocle: the processor is built there.
    process.env.MONOCLE_ENABLE_TRACE_RETURN = "true";
    process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY = RETRIEVAL_KEY;
    const monocle = await import("../../src/index");
    monocle.setupMonocle("health-sampling-demo", [collector]);

    server = http.createServer((req, res) => {
        if (req.url === "/healthz") { res.statusCode = 200; res.end(); return; }
        // A route ending in a known one, answering with a failure.
        if (req.url === "/healthz-failing") { res.statusCode = 503; res.end(); return; }
        res.setHeader("content-type", "application/json");
        res.end('{"ok":true}');
    });
    server.listen(0);
    await new Promise((r) => server.once("listening", r));
    port = server.address().port;
});

afterAll(() => {
    delete process.env.MONOCLE_HEALTH_CHECK_SAMPLE_RATE;
    delete process.env.MONOCLE_ENABLE_TRACE_RETURN;
    delete process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY;
    server?.close();
});

beforeEach(() => {
    exported.length = 0;
    // Counters persist across tests, so without this the second test starts
    // mid-cycle and exports nothing.
    resetHealthCheckStateForTests();
});

describe("a probed health route", () => {
    it("exports the first request and then one in every five", async () => {
        for (let i = 0; i < 11; i++) await get("/healthz");
        await settle();
        expect(named("http.process").length).toBe(3);
    });

    // The orphan this design exists to prevent: a trace root with nothing
    // under it is worse than the noise it replaced.
    it("drops the workflow span along with its child", async () => {
        for (let i = 0; i < 4; i++) await get("/healthz");
        await settle();
        expect(named("http.process").length).toBe(1);
        expect(named("workflow").length).toBe(1);
    });
});

describe("failures are never sampled away", () => {
    it("exports every failing probe", async () => {
        for (let i = 0; i < 11; i++) await get("/healthz-failing");
        await settle();
        expect(named("http.process").length).toBe(11);
    });
});

describe("ordinary traffic", () => {
    it("is untouched by sampling", async () => {
        for (let i = 0; i < 11; i++) await get("/api/orders");
        await settle();
        expect(named("http.process").length).toBe(11);
    });
});

describe("trace return", () => {
    // "Covered for free by the flag" is a claim, so it gets a test.
    it("returns no spans for a sampled-out probe", async () => {
        await get("/healthz");                       // burns the free first sample
        const body = await get("/healthz", { "x-monocle-retrieve-traces": RETRIEVAL_KEY });
        await settle();
        expect(body).not.toContain("__MONOCLE_TRACES__");
    });
});

describe("the suppression mechanism itself", () => {
    // The only test that catches an SDK upgrade where spanContext() returns a
    // copy. Without it that change fails silently, as health spans reappearing.
    it("stops a span reaching the exporter when its SAMPLED flag is cleared", async () => {
        // The instrumentor's tracer, not trace.getTracer(): setupMonocle
        // registers no global provider, so an api tracer goes nowhere and the
        // test would pass whatever the flag did.
        const { getInstrumentor } = await import("../../src/instrumentation/common/utils");
        const tracer = getInstrumentor()!.getTracer();

        const kept = tracer.startSpan("control-is-exported");
        kept.end();

        const dropped = tracer.startSpan("should-not-be-exported");
        dropped.spanContext().traceFlags = TraceFlags.NONE;
        dropped.end();

        await settle();
        expect(exported.find((s) => s.name === "control-is-exported")).toBeDefined();
        expect(exported.find((s) => s.name === "should-not-be-exported")).toBeUndefined();
    });
});

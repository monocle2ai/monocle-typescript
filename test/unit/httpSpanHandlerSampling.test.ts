import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { DefaultSpanHandler } from "../../src/instrumentation/common/spanHandler";
import { HttpSpanHandler } from "../../src/instrumentation/http/httpSpanHandler";
import { resetHealthCheckStateForTests } from "../../src/instrumentation/http/healthCheck";

const ENV_KEYS = [
    "MONOCLE_SAMPLE_HEALTH_CHECKS",
    "MONOCLE_HEALTH_CHECK_ROUTES",
    "MONOCLE_HEALTH_CHECK_SAMPLE_RATE",
];

// A probe-shaped span. Each test changes exactly one thing, so a passing test
// tells you about that one clause.
function probeSpan(overrides: {
    method?: string; route?: string; statusCode?: string; response?: string;
    params?: string; requestBody?: string; endReason?: string;
    status?: { code: number }; events?: any[];
} = {}): any {
    const input: Record<string, any> = {};
    if (overrides.params !== undefined) input.params = overrides.params;
    if (overrides.requestBody !== undefined) input.request_body = overrides.requestBody;

    const output: Record<string, any> = { status_code: overrides.statusCode ?? "200" };
    if (overrides.response !== undefined) output.response = overrides.response;
    if (overrides.endReason !== undefined) output.end_reason = overrides.endReason;

    return {
        attributes: {
            "entity.1.method": overrides.method ?? "GET",
            "entity.1.route": overrides.route ?? "/healthz",
        },
        status: overrides.status ?? { code: SpanStatusCode.OK },
        events: overrides.events ?? [
            { name: "data.input", attributes: input },
            { name: "data.output", attributes: output },
        ],
    };
}

let handler: HttpSpanHandler;

beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    resetHealthCheckStateForTests();
    handler = new HttpSpanHandler();
    // Burn the free first sample, so these exercise the predicate rather than
    // the always-export-the-first rule.
    handler.shouldSample({ span: probeSpan() });
});
afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    resetHealthCheckStateForTests();
});

describe("the base handler", () => {
    it("samples nothing", () => {
        expect(new DefaultSpanHandler().shouldSample({ span: probeSpan() })).toBe(true);
    });
});

describe("a probe is dropped", () => {
    it("when it is an ordinary successful contentless GET", () => {
        expect(handler.shouldSample({ span: probeSpan() })).toBe(false);
    });

    // Upstream PR #792: probes commonly reply {"status":"ok"}, and that must
    // not make them look like real traffic.
    it("even when it answers with a body, on a known route", () => {
        expect(handler.shouldSample({ span: probeSpan({ response: '{"status":"ok"}' }) })).toBe(false);
    });
});

describe("a probe is always exported", () => {
    it("when sampling is switched off", () => {
        process.env.MONOCLE_SAMPLE_HEALTH_CHECKS = "false";
        expect(handler.shouldSample({ span: probeSpan() })).toBe(true);
    });

    it("when the method is not GET or HEAD", () => {
        expect(handler.shouldSample({ span: probeSpan({ method: "POST" }) })).toBe(true);
    });

    it("when the span status is ERROR", () => {
        expect(handler.shouldSample({
            span: probeSpan({ status: { code: SpanStatusCode.ERROR } }),
        })).toBe(true);
    });

    it("when the status code is 4xx or 5xx", () => {
        expect(handler.shouldSample({ span: probeSpan({ statusCode: "503" }) })).toBe(true);
    });

    it("when the request carried a query string", () => {
        expect(handler.shouldSample({ span: probeSpan({ params: "verbose=1" }) })).toBe(true);
    });

    it("when the request carried a body", () => {
        expect(handler.shouldSample({ span: probeSpan({ requestBody: '{"x":1}' }) })).toBe(true);
    });

    // No upstream counterpart: monocle_apptrace has no streaming fields.
    it("when the stream did not end cleanly", () => {
        expect(handler.shouldSample({ span: probeSpan({ endReason: "client_closed" }) })).toBe(true);
    });

    it("when an unlisted route answers with a body", () => {
        expect(handler.shouldSample({
            span: probeSpan({ route: "/api/orders", response: '{"orders":[]}' }),
        })).toBe(true);
    });

    it("when the span has no events at all", () => {
        expect(handler.shouldSample({ span: probeSpan({ events: [] }) })).toBe(true);
    });
});

describe("robustness", () => {
    // The failure mode of a sampler must be noise, never silence.
    it("exports rather than throwing on a malformed span", () => {
        expect(handler.shouldSample({ span: undefined as any })).toBe(true);
        expect(handler.shouldSample({ span: {} as any })).toBe(true);
    });
});

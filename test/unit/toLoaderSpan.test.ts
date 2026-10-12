import { describe, it, expect } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import { toLoaderSpan } from "../../src/traceReturn/toLoaderSpan";

function mkSpan(overrides: any = {}): any {
    return {
        name: "agentic.turn",
        spanContext: () => ({
            traceId: "25438b035b91b5cdeab57328eb048ab4",
            spanId: "f388d1e4fd40bbcb",
            traceFlags: 1,
        }),
        kind: SpanKind.INTERNAL,
        parentSpanContext: { spanId: "3ca791529809bb01" },
        startTime: [1754938891, 480000000],
        endTime: [1754938896, 579000000],
        status: { code: 1, message: "OK" },
        attributes: { "span.type": "agentic.turn", "entity.1.name": "math_agent" },
        events: [],
        links: [],
        resource: { attributes: { SERVICE_NAME: "a2a.server" } },
        ...overrides,
    };
}

describe("toLoaderSpan — kind", () => {
    it("emits a string the loader can call .replace() on", () => {
        expect(toLoaderSpan(mkSpan()).kind).toBe("SpanKind.INTERNAL");
    });

    // The case that matters: the HTTP request root span is SpanKind.SERVER, and
    // exportInfo's numeric 1 makes JSONSpanLoader raise AttributeError.
    it("handles SERVER, the kind the request root span will use", () => {
        expect(toLoaderSpan(mkSpan({ kind: SpanKind.SERVER })).kind).toBe("SpanKind.SERVER");
    });

    it("degrades an unknown kind to INTERNAL rather than 'SpanKind.undefined'", () => {
        expect(toLoaderSpan(mkSpan({ kind: 99 })).kind).toBe("SpanKind.INTERNAL");
    });
});

describe("toLoaderSpan — links", () => {
    it("rewrites link context to the snake_case keys the loader indexes", () => {
        const links = [{
            context: {
                traceId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                spanId: "9999999999999999",
                traceFlags: 1,
            },
            attributes: { "link.kind": "a2a" },
        }];

        expect(toLoaderSpan(mkSpan({ links })).links).toEqual([{
            context: {
                trace_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                span_id: "9999999999999999",
                trace_flags: 1,
            },
            attributes: { "link.kind": "a2a" },
        }]);
    });

    it("omits attributes when the link has none", () => {
        const links = [{ context: { traceId: "b".repeat(32), spanId: "9".repeat(16), traceFlags: 1 } }];
        expect(toLoaderSpan(mkSpan({ links })).links[0]).not.toHaveProperty("attributes");
    });

    it("leaves an empty link list empty", () => {
        expect(toLoaderSpan(mkSpan()).links).toEqual([]);
    });
});

describe("toLoaderSpan — pass-through", () => {
    it("leaves the fields exportInfo already gets right alone", () => {
        const out = toLoaderSpan(mkSpan());
        expect(out.context.trace_id).toBe("25438b035b91b5cdeab57328eb048ab4");
        expect(out.parent_id).toBe("3ca791529809bb01");
        expect(out.start_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
        expect(out.status.status_code).toBe("OK");
        expect(out.attributes["entity.1.name"]).toBe("math_agent");
        expect(out.resource.attributes["service.name"]).toBe("a2a.server");
    });
});

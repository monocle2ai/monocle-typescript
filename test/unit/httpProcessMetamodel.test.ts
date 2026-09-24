import { describe, it, expect } from "vitest";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { HTTP_PROCESS } from "../../src/instrumentation/metamodel/http/entities/httpProcess";
import { DefaultSpanHandler } from "../../src/instrumentation/common/spanHandler";
import { appendResponseChunk } from "../../src/instrumentation/http/capture";

// A span stub that records what processSpan writes. Using the real SDK span
// would drag in a provider; only the recorded calls matter here.
function fakeSpan(parentSpanId: string | undefined) {
    const attributes: Record<string, any> = {};
    const events: { name: string; attributes: Record<string, any> }[] = [];
    return {
        attributes,
        events,
        parentSpanContext: parentSpanId ? { spanId: parentSpanId } : undefined,
        setAttribute(k: string, v: any) { attributes[k] = v; return this; },
        addEvent(name: string, attrs: Record<string, any>) { events.push({ name, attributes: attrs }); return this; },
        setStatus() { return this; },
        end() { },
        spanContext() { return { traceId: "t", spanId: "s" }; },
        status: { code: SpanStatusCode.UNSET },
        kind: SpanKind.SERVER,
    } as any;
}

function apply(req: any, res: any, parentSpanId?: string) {
    // arguments.length distinguishes "omitted" (default parent) from an
    // explicit undefined (root span, no parent) - a default param on
    // fakeSpan can't tell those apart since it fires on undefined either way.
    const span = fakeSpan(arguments.length >= 3 ? parentSpanId : "aaaabbbbccccdddd");
    new DefaultSpanHandler().processSpan({
        span,
        instance: req,
        args: [req] as any,
        returnValue: res,
        outputProcessor: [HTTP_PROCESS],
        wrappedPackage: "node:http",
    });
    return span;
}

const req = {
    method: "POST",
    url: "/api/v1/ask?lang=en&verbose=true",
    baseUrl: "/api",
    route: { path: "/v1/ask" },
    headers: { host: "127.0.0.1:8123" },
    socket: {},
    body: { question: "What is Task Decomposition?" },
};

function resWith(body: string) {
    // Honours the header name: a stub answering every name alike would also
    // claim a content-encoding, which suppresses capture.
    const res: any = {
        statusCode: 200,
        getHeader: (n: string) => (n.toLowerCase() === "content-type" ? "application/json" : undefined),
    };
    appendResponseChunk(res, body);
    return res;
}

describe("http.process metamodel", () => {
    it("emits the attribute keys monocle_apptrace emits, at entity.1", () => {
        const span = apply(req, resWith('{"answer":"42"}'));
        expect(span.attributes["span.type"]).toBe("http.process");
        expect(span.attributes["entity.1.method"]).toBe("POST");
        expect(span.attributes["entity.1.route"]).toBe("/api/v1/ask");
        expect(span.attributes["entity.1.url"]).toBe("http://127.0.0.1:8123/api/v1/ask?lang=en&verbose=true");
    });

    it("emits data.input with params and request_body", () => {
        const span = apply(req, resWith("{}"));
        const input = span.events.find((e: any) => e.name === "data.input");
        expect(input.attributes).toEqual({
            params: "lang=en&verbose=true",
            request_body: '{"question":"What is Task Decomposition?"}',
        });
    });

    it("emits data.output with a string status_code and the response", () => {
        const span = apply(req, resWith('{"answer":"42"}'));
        const output = span.events.find((e: any) => e.name === "data.output");
        expect(output.attributes).toEqual({
            status_code: "200",
            response: '{"answer":"42"}',
        });
    });

    // Review Focus 4: an absent query must omit params rather than emit "".
    it("omits params entirely when there is no query string", () => {
        const span = apply({ ...req, url: "/api/v1/ask" }, resWith("{}"));
        const input = span.events.find((e: any) => e.name === "data.input");
        expect(input.attributes).not.toHaveProperty("params");
    });

    it("lands attributes at entity.3 when the span is the trace root, which is why the workflow span must be the parent", () => {
        const span = apply(req, resWith("{}"), undefined);
        expect(span.attributes["entity.3.method"]).toBe("POST");
        expect(span.attributes["entity.1.method"]).toBeUndefined();
    });
});

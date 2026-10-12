import { describe, it, expect, beforeAll } from "vitest";
import { context } from "@opentelemetry/api";
import { SpanProcessor } from "@opentelemetry/sdk-trace-node";

const noop: SpanProcessor = {
    onStart() { }, onEnd() { },
    shutdown() { return Promise.resolve(); },
    forceFlush() { return Promise.resolve(); },
};

describe("request root span", () => {
    let startTraceReturnRequest: any, getTraceReturnExporter: any;
    let getPatchedMain: any, getInstrumentor: any;

    beforeAll(async () => {
        process.env.MONOCLE_ENABLE_TRACE_RETURN = "true";
        const monocle = await import("../../src/index");
        monocle.setupMonocle("req-span-demo", [noop]);
        ({ startTraceReturnRequest } = await import("../../src/traceReturn/requestSpan"));
        ({ getTraceReturnExporter } = await import("../../src/traceReturn/exporter"));
        ({ getPatchedMain } = await import("../../src/instrumentation/common/wrapper"));
        ({ getInstrumentor } = await import("../../src/instrumentation/common/utils"));
    });

    it("gives one trace per request and keeps the injected workflow span", async () => {
        // Drive the real wrapper rather than a mock, so the ADD_NEW_WORKFLOW
        // interaction is genuinely exercised.
        const patched = getPatchedMain({
            tracer: getInstrumentor().getTracer(),
            package: "@langchain/core", object: "Runnable", method: "invoke",
            spanName: "langchain.invoke",
        })(async function realWork() { return "done"; });

        const req = startTraceReturnRequest({
            name: "POST /chat",
            attributes: { "http.method": "POST" },
        });
        expect(req).not.toBeNull();

        expect(await context.with(req.context, () => patched.call({}))).toBe("done");
        req.end({ httpStatus: 200 });

        const spans = getTraceReturnExporter().popSpansForTrace(req.traceId);
        const byName = (n: string) => spans.find((s: any) => s.name === n);
        const id = (s: any) => s.spanContext().spanId;

        // Everything in the buffer means everything was scope-tagged.
        expect(spans).toHaveLength(3);
        expect(new Set(spans.map((s: any) => s.spanContext().traceId)).size).toBe(1);

        const root = byName("POST /chat");
        expect(root.parentSpanContext).toBeUndefined();
        expect(root.attributes["http.status_code"]).toBe(200);

        // The regression this whole flag exists to prevent.
        const workflow = byName("workflow");
        expect(workflow, "ADD_NEW_WORKFLOW must still inject a workflow span").toBeTruthy();
        expect(workflow.parentSpanContext.spanId).toBe(id(root));
        // Derived from the wrapped package, not the generic fallback a workflow
        // span opened at request time would have been stuck with.
        expect(workflow.attributes["entity.1.type"]).toBe("workflow.langchain");

        expect(byName("langchain.invoke").parentSpanContext.spanId).toBe(id(workflow));
    });

    it("end() is idempotent, because res.end can fire twice", () => {
        const req = startTraceReturnRequest();
        req.end({ httpStatus: 200 });
        req.end({ httpStatus: 500 });
        const spans = getTraceReturnExporter().popSpansForTrace(req.traceId);
        expect(spans).toHaveLength(1);
        expect(spans[0].attributes["http.status_code"]).toBe(200);
    });
});

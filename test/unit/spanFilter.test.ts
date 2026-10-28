import { describe, it, expect } from "vitest";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { SpanFilter } from "../../src/exporters/spanFilter";

function makeSpan(spanType = "inference") {
    const memory = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memory)] });
    const span = provider.getTracer("test").startSpan("openai.chat.completions.create");
    span.setAttributes({
        "span.type": spanType,
        "monocle_apptrace.version": "0.4.0",
        "entity.1.name": "openai",
        "entity.2.name": "gpt-4",
        "scope.customer_id": "cus_1",
        "scope.session_id": "sess_1",
    });
    span.addEvent("data.input", { input: "hi" });
    span.addEvent("data.output", { response: "hello" });
    span.addEvent("metadata", { completion_tokens: 1, prompt_tokens: 2, total_tokens: 3, finish_reason: "stop" });
    span.end();
    return memory.getFinishedSpans()[0];
}

describe("SpanFilter", () => {
    it("rejects an invalid mode", () => {
        expect(() => new SpanFilter({ mode: "other" as any })).toThrow("mode must be 'include' or 'exclude'");
    });

    it.each([
        [["inference"], "inference", true],
        [["retrieval"], "inference", false],
        [["inference.*"], "inference.framework", true],
        [["inference.*"], "inference", true],
        [["*"], "anything", true],
        [["*.framework"], "inference.framework", true],
        [["agentic.*.invocation"], "agentic.tool.invocation", true],
        [["agentic.*.invocation"], "agentic.tool", false],
    ])("with types %o includes a %s span: %s", (types, spanType, expected) => {
        expect(new SpanFilter({ spanTypesToInclude: types }).shouldIncludeSpan(makeSpan(spanType))).toBe(expected);
    });

    it("drops the listed types in exclude mode", () => {
        const spanFilter = new SpanFilter({ spanTypesToInclude: ["inference"], mode: "exclude" });
        expect(spanFilter.shouldIncludeSpan(makeSpan("inference"))).toBe(false);
        expect(spanFilter.shouldIncludeSpan(makeSpan("retrieval"))).toBe(true);
    });

    it("returns null for a span whose type is filtered out", () => {
        expect(new SpanFilter({ spanTypesToInclude: ["retrieval"] }).filter(makeSpan())).toBeNull();
    });

    it("projects the listed attributes", () => {
        const filtered = new SpanFilter({
            fieldsToInclude: { attributes: ["entity.1.name", "entity.2.name", "scope.customer_id"] },
        }).filter(makeSpan());
        expect(Object.keys(filtered.attributes).sort()).toEqual(["entity.1.name", "entity.2.name", "scope.customer_id"]);
    });

    it("projects attributes by wildcard", () => {
        const filtered = new SpanFilter({ fieldsToInclude: { attributes: ["scope.*"] } }).filter(makeSpan());
        expect(filtered.attributes).toEqual({ "scope.customer_id": "cus_1", "scope.session_id": "sess_1" });
    });

    it("projects events and their attributes", () => {
        const filtered = new SpanFilter({
            fieldsToInclude: { events: [{ name: "metadata", attributes: ["completion_tokens", "prompt_tokens"] }] },
        }).filter(makeSpan());
        expect(filtered.events).toHaveLength(1);
        expect(filtered.events[0].name).toBe("metadata");
        expect(filtered.events[0].attributes).toEqual({ completion_tokens: 1, prompt_tokens: 2 });
    });

    it("keeps whole events when no event attributes are listed", () => {
        const filtered = new SpanFilter({
            fieldsToInclude: { events: [{ name: "data.input" }, { name: "metadata" }] },
        }).filter(makeSpan());
        expect(filtered.events.map(event => event.name)).toEqual(["data.input", "metadata"]);
        expect(filtered.events[1].attributes).toHaveProperty("total_tokens", 3);
    });

    it("keeps every field when none are listed", () => {
        const span = makeSpan();
        const filtered = new SpanFilter({}).filter(span);
        expect(filtered.attributes).toEqual(span.attributes);
        expect(filtered.events).toHaveLength(span.events.length);
    });
});

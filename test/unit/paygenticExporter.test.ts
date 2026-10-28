import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import axios from "axios";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { PaygenticSpanExporter } from "../../src/exporters/paygentic/PaygenticSpanExporter";
import { getMonocleExporters } from "../../src/exporters";

const ENDPOINT = "https://paygentic.test/v0/events";

// Finishes one span carrying the given monocle scopes and returns it.
function makeSpan(scopes: Record<string, string>, { spanType = "inference", monocle = true, metadata = true } = {}) {
    const memory = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memory)] });
    const span = provider.getTracer("test").startSpan("openai.chat");
    if (monocle) {
        span.setAttribute("monocle_apptrace.version", "0.4.0");
    }
    span.setAttribute("span.type", spanType);
    span.setAttribute("entity.1.type", "inference.openai");
    for (const [name, value] of Object.entries(scopes)) {
        span.setAttribute(`scope.${name}`, value);
    }
    if (metadata) {
        span.addEvent("metadata", { total_tokens: 42 });
    }
    span.end();
    return memory.getFinishedSpans()[0];
}

function exportSpans(exporter: PaygenticSpanExporter, spans: any[]): Promise<ExportResult> {
    return new Promise(resolve => exporter.export(spans, resolve));
}

describe("PaygenticSpanExporter", () => {
    const originalEnv = process.env;
    let post: ReturnType<typeof vi.fn>;
    let exporter: PaygenticSpanExporter;

    beforeEach(() => {
        process.env = { ...originalEnv, PAYGENTIC_API_KEY: "test-key" };
        post = vi.fn().mockResolvedValue({ status: 202, data: {} });
        vi.spyOn(axios, "create").mockReturnValue({ post } as any);
        exporter = new PaygenticSpanExporter({ endpoint: ENDPOINT });
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    // Exports one span and returns the event bodies posted to Paygentic.
    async function exportScopes(scopes: Record<string, string>) {
        await exportSpans(exporter, [makeSpan(scopes)]);
        return post.mock.calls.map(call => call[1]);
    }

    describe("customer scopes", () => {
        it("sends customerId as subject", async () => {
            const [event] = await exportScopes({ customerId: "cus_123" });
            expect(event.subject).toBe("cus_123");
            expect(event).not.toHaveProperty("externalSubject");
        });

        it("sends externalCustomerId as externalSubject", async () => {
            const [event] = await exportScopes({ externalCustomerId: "acme-42" });
            expect(event.externalSubject).toBe("acme-42");
            expect(event).not.toHaveProperty("subject");
        });

        it("sends both customer scopes", async () => {
            const [event] = await exportScopes({ customerId: "cus_123", externalCustomerId: "acme-42" });
            expect(event.subject).toBe("cus_123");
            expect(event.externalSubject).toBe("acme-42");
        });

        it("does not use subscriptionId as the subject", async () => {
            const [event] = await exportScopes({ subscriptionId: "sub_456", customerId: "cus_123" });
            expect(event.subject).toBe("cus_123");
            expect(JSON.stringify(event)).not.toContain("sub_456");
        });

        it("drops a span without a customer scope and logs an error", async () => {
            const error = vi.spyOn(console, "error").mockImplementation(() => { });
            const events = await exportScopes({ subscriptionId: "sub_456" });
            expect(events).toEqual([]);
            expect(error).toHaveBeenCalledWith(expect.stringContaining("No customerId or externalCustomerId scope"));
        });
    });

    describe("event", () => {
        it("posts a CloudEvent built from the span", async () => {
            const span = makeSpan({ customerId: "cus_123" });
            const { traceId, spanId } = span.spanContext();
            const result = await exportSpans(exporter, [span]);

            expect(result.code).toBe(ExportResultCode.SUCCESS);
            expect(post).toHaveBeenCalledWith(ENDPOINT, {
                type: "ai.inference.openai",
                source: "monocle",
                subject: "cus_123",
                idempotencyKey: `${traceId}_${spanId}`,
                data: { span_id: spanId, trace_id: traceId, name: "openai.chat", total_tokens: 42 },
            });
            expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
                headers: { "Content-Type": "application/json", "Authorization": "Bearer test-key" },
            }));
        });

        it("adds the namespace and source when configured", async () => {
            exporter = new PaygenticSpanExporter({ endpoint: ENDPOINT, namespace: "org_1", source: "my-app" });
            const [event] = await exportScopes({ customerId: "cus_123" });
            expect(event.namespace).toBe("org_1");
            expect(event.source).toBe("my-app");
        });

        it.each([
            ["a span Monocle did not create", { monocle: false }],
            ["a span that is not an inference span", { spanType: "retrieval" }],
            ["a span without a metadata event", { metadata: false }],
        ])("skips %s", async (_, options) => {
            const result = await exportSpans(exporter, [makeSpan({ customerId: "cus_123" }, options)]);
            expect(result.code).toBe(ExportResultCode.SUCCESS);
            expect(post).not.toHaveBeenCalled();
        });

        it("keeps inference subtypes", async () => {
            await exportSpans(exporter, [makeSpan({ customerId: "cus_123" }, { spanType: "inference.framework" })]);
            expect(post).toHaveBeenCalledTimes(1);
        });

        it("fails a batch after shutdown", async () => {
            await exporter.shutdown();
            const result = await exportSpans(exporter, [makeSpan({ customerId: "cus_123" })]);
            expect(result.code).toBe(ExportResultCode.FAILED);
            expect(post).not.toHaveBeenCalled();
        });
    });

    describe("configuration", () => {
        it("requires PAYGENTIC_API_KEY", () => {
            delete process.env.PAYGENTIC_API_KEY;
            expect(() => new PaygenticSpanExporter()).toThrow("PAYGENTIC_API_KEY not set.");
        });

        it.each([
            [{}, "https://api.paygentic.io/v0/events"],
            [{ PAYGENTIC_SANDBOX: "TRUE" }, "https://api.sandbox.paygentic.io/v0/events"],
            [{ PAYGENTIC_SANDBOX: "true", PAYGENTIC_EVENT_ENDPOINT: ENDPOINT }, ENDPOINT],
        ])("picks the endpoint from %o", async (env, endpoint) => {
            Object.assign(process.env, env);
            exporter = new PaygenticSpanExporter();
            await exportScopes({ customerId: "cus_123" });
            expect(post.mock.calls[0][0]).toBe(endpoint);
        });

        it("reads PAYGENTIC_TIMEOUT in seconds", () => {
            process.env.PAYGENTIC_TIMEOUT = "5";
            new PaygenticSpanExporter();
            expect(axios.create).toHaveBeenLastCalledWith(expect.objectContaining({ timeout: 5000 }));
        });

        it("is registered as MONOCLE_EXPORTER=paygentic", () => {
            const exporters = getMonocleExporters("paygentic");
            expect(exporters).toHaveLength(1);
            expect(exporters[0]).toBeInstanceOf(PaygenticSpanExporter);
        });
    });

    describe("responses", () => {
        it("suppresses an event type the API rejects", async () => {
            vi.spyOn(console, "warn").mockImplementation(() => { });
            post.mockResolvedValue({ status: 422, data: { error: "invalid_event_type" } });

            expect((await exportSpans(exporter, [makeSpan({ customerId: "cus_123" })])).code).toBe(ExportResultCode.SUCCESS);
            await exportSpans(exporter, [makeSpan({ customerId: "cus_123" })]);
            expect(post).toHaveBeenCalledTimes(1);
        });

        it("fails a client error without retrying", async () => {
            vi.spyOn(console, "error").mockImplementation(() => { });
            post.mockResolvedValue({ status: 400, data: { message: "bad" } });

            const result = await exportSpans(exporter, [makeSpan({ customerId: "cus_123" })]);
            expect(result.code).toBe(ExportResultCode.FAILED);
            expect(post).toHaveBeenCalledTimes(1);
        });

        it("retries server errors and network errors, then succeeds", async () => {
            vi.useFakeTimers();
            vi.spyOn(console, "warn").mockImplementation(() => { });
            post
                .mockResolvedValueOnce({ status: 503, data: {} })
                .mockRejectedValueOnce(new Error("timeout of 15000ms exceeded"))
                .mockResolvedValueOnce({ status: 202, data: {} });

            const result = exportSpans(exporter, [makeSpan({ customerId: "cus_123" })]);
            await vi.runAllTimersAsync();
            expect((await result).code).toBe(ExportResultCode.SUCCESS);
            expect(post).toHaveBeenCalledTimes(3);
        });

        it("gives up after three attempts", async () => {
            vi.useFakeTimers();
            vi.spyOn(console, "warn").mockImplementation(() => { });
            vi.spyOn(console, "error").mockImplementation(() => { });
            post.mockResolvedValue({ status: 429, data: {} });

            const result = exportSpans(exporter, [makeSpan({ customerId: "cus_123" })]);
            await vi.runAllTimersAsync();
            expect((await result).code).toBe(ExportResultCode.FAILED);
            expect(post).toHaveBeenCalledTimes(3);
        });
    });
});

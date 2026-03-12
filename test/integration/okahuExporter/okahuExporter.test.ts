import { describe, it, beforeAll, expect } from "vitest";
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { OkahuSpanExporter } from "../../../src/exporters/okahu/OkahuSpanExporter";

const OKAHU_DEV_INGEST_ENDPOINT =
  "https://okahu-ingestion-dev-scus.azurewebsites.net/api/v1/trace/ingest";
describe("OkahuSpanExporter Integration Tests", () => {
  beforeAll(() => {
    if (!process.env.OKAHU_API_KEY) {
      throw new Error(
        "OKAHU_API_KEY environment variable is required to run these tests.",
      );
    }
  });

  async function createAndExportSpan(
    provider: NodeTracerProvider,
    spanName: string,
    attributes: Record<string, string> = {},
  ): Promise<string> {
    const tracer = provider.getTracer("okahu-test");
    const span = tracer.startSpan(spanName);
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
    const traceId = span.spanContext().traceId;
    span.end();

    await provider.forceFlush(); // wait for HTTP POST, don't shutdown yet
    return traceId;
  }

  it("should ingest trace with evaluate=false (standard ingest)", async () => {
    const exporter = new OkahuSpanExporter({
      evaluate: false,
      endpoint: OKAHU_DEV_INGEST_ENDPOINT,
    });
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();

    const traceId = await createAndExportSpan(provider, "standard-operation", {
      input: "What is an americano?",
      type: "standard",
    });

    console.log(`Standard trace ingested. trace_id: ${traceId}`);
    expect(traceId).toBeDefined();
    expect(traceId).toHaveLength(32);

    await provider.shutdown();
  }, 30000);

  it("should ingest trace with evaluate=true (eval ingest) and then delete it", async () => {
    const exporter = new OkahuSpanExporter({
      evaluate: true,
      endpoint: OKAHU_DEV_INGEST_ENDPOINT,
    });
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();

    const traceId = await createAndExportSpan(provider, "eval-operation", {
      input: "What is an americano?",
      type: "eval",
    });

    console.log(`Eval trace ingested. trace_id: ${traceId}`);
    expect(traceId).toBeDefined();
    expect(traceId).toHaveLength(32);

    // exporter is still open — delete before shutdown
    const deleted = await exporter.deleteTrace(
      traceId,
      OKAHU_DEV_INGEST_ENDPOINT,
    );
    console.log(`Delete result for trace ${traceId}: ${deleted}`);
    expect(deleted).toBe(true);

    await provider.shutdown();
  }, 30000);
});

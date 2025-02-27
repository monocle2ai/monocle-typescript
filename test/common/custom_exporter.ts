import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { ExportResult } from "@opentelemetry/core";
import { ReadableSpan } from "@opentelemetry/sdk-trace-base";
interface CapturedSpan {
  name: string;
  attributes: Record<string, any>;
  events: any[];
  parent?: CapturedSpan;
}

export class CustomConsoleSpanExporter extends ConsoleSpanExporter {
  private capturedSpans: CapturedSpan[] = [];

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void
  ): void {
    // Store spans for later assertions
    this.capturedSpans.push(...spans);
    // Call the parent method with both required arguments
    super.export(spans, resultCallback);
  }

  getCapturedSpans(): CapturedSpan[] {
    return this.capturedSpans;
  }
}

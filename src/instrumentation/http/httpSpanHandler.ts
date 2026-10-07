// The analogue of monocle_apptrace's HttpSpanHandler: whether an http.process
// span is a health check worth keeping.
//
// Clause order is upstream's and load-bearing. Every always-export check runs
// before the counter, so real traffic never consumes a sample slot and a
// failing probe is returned before the counter is reached.
import { SpanStatusCode } from "@opentelemetry/api";
import { consoleLog } from "../../common/logging";
import { Span } from "../common/opentelemetryUtils";
import { DefaultSpanHandler } from "../common/spanHandler";
import { isHealthCheckRoute, isHealthCheckSamplingEnabled, takeSample } from "./healthCheck";

const SAMPLED_METHODS = new Set(["get", "head"]);

function eventAttributes(span: any, name: string): Record<string, any> {
    const event = (span?.events ?? []).find((e: any) => e?.name === name);
    return event?.attributes ?? {};
}

export class HttpSpanHandler extends DefaultSpanHandler {
    shouldSample({ span }: { span: Span }): boolean {
        try {
            return decide(span as any);
        } catch (e) {
            // Noise beats silence: a broken predicate must not delete spans.
            consoleLog(`[monocle] health check sampling failed, exporting the span: ${e}`);
            return true;
        }
    }
}

function decide(span: any): boolean {
    if (!isHealthCheckSamplingEnabled()) return true;

    const attributes = span?.attributes ?? {};
    const method = String(attributes["entity.1.method"] ?? "").toLowerCase();
    if (!SAMPLED_METHODS.has(method)) return true;

    // Covers 5xx, a torn-down stream, and a disconnect before any byte.
    if (span?.status?.code === SpanStatusCode.ERROR) return true;

    const events = span?.events ?? [];
    if (events.length === 0) return true;

    // Either means a caller with something to say, so not a probe.
    const input = eventAttributes(span, "data.input");
    if (input.params || input.request_body) return true;

    const output = eventAttributes(span, "data.output");

    const statusCode = Number(output.status_code);
    if (Number.isFinite(statusCode) && statusCode >= 400) return true;

    // No upstream counterpart - monocle_apptrace has no streaming fields.
    if (output.end_reason !== undefined && output.end_reason !== "complete") return true;

    const route = String(attributes["entity.1.route"] ?? "");
    const isProbe = isHealthCheckRoute(route);

    // A contentless GET still looks like a probe on an unlisted route; one
    // that answers with content does not, unless we already know it is a
    // probe. That last clause is upstream's PR #792.
    if (output.response && !isProbe) return true;

    // Configured probes get their own counter, everything else shares one.
    return takeSample(isProbe ? route : "");
}

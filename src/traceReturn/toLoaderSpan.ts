import { SpanKind } from "@opentelemetry/api";
import { Span } from "@opentelemetry/sdk-trace-base";
import {exportInfo, SpanExport} from "../exporters/utils";

// Adapts exportInfo() output to what monocle_test_tools' JSONSpanLoader._from_dict expects. we don't modify the exportInfo() as every other exporter and tests depend on it.

export interface LoaderSpan extends Omit<SpanExport, "kind" | "links"> {
    // A string, not the enum: the whole point of this adapter is that the loader
    // calls .replace("SpanKind.", "") on this value.
    kind: string;
    links: Array<{
        context: { trace_id: string; span_id: string; trace_flags: number };
        attributes?: Record<string, unknown>;
    }>
}

// A function, not a module-level map: an unrecognised value must degrade to a
// valid name rather than "SpanKind.undefined" (what SpanKind[n] gives), and
// reading SpanKind at call time keeps this loadable under partial api mocks.
function spanKindName(kind: number): string {
    switch (kind) {
        case SpanKind.SERVER: return "SERVER";
        case SpanKind.CLIENT: return "CLIENT";
        case SpanKind.PRODUCER: return "PRODUCER";
        case SpanKind.CONSUMER: return "CONSUMER";
        default: return "INTERNAL";
    }
}

export function toLoaderSpan(span: Span): LoaderSpan {
    const exported = exportInfo(span);
    return {
        ...exported,
        // exportInfo emits the numeric enum, but the loader does
        // kind.replace("SpanKind.", "") — an int has no .replace, so any non-INTERNAL
        // span raises AttributeError and the client loses the whole payload. INTERNAL
        // survives only because 0 is falsy and the loader's `if` skips it.
        kind: `SpanKind.${spanKindName(span.kind)}`,
        // exportInfo passes OTel-JS links straight through, so context is
        // camelCase (traceId/spanId). The loader hard-indexes link_data["context"]
        // then context_data["trace_id"] — KeyError. Empty today, so this is a
        // latent crash that A2A/MCP link usage would trip.
        links: (span.links ?? []).map((link) => ({
            context: {
                trace_id: link.context.traceId,
                span_id: link.context.spanId,
                trace_flags: link.context.traceFlags,
            },
            // Omit when absent: the loader uses .get("attributes"), so a missing
            // key is fine but an explicit undefined would serialise oddly.
            ...(link.attributes ? { attributes: link.attributes } : {}),
        })),
    };
}

import { ExportResult } from '@opentelemetry/core';
import { Attributes } from '@opentelemetry/api';
import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-node';
import { consoleLog } from '../../common/logging';
import { getGenaiAttributes } from './genaiSemconv';

// Copy of the span with extra attributes; the original stays untouched for other exporters.
function withAttributes(span: ReadableSpan, extra: Attributes): ReadableSpan {
    return {
        name: span.name,
        kind: span.kind,
        spanContext: () => span.spanContext(),
        parentSpanContext: span.parentSpanContext,
        startTime: span.startTime,
        endTime: span.endTime,
        status: span.status,
        attributes: { ...span.attributes, ...extra },
        links: span.links,
        events: span.events,
        duration: span.duration,
        ended: span.ended,
        resource: span.resource,
        instrumentationScope: span.instrumentationScope,
        droppedAttributesCount: span.droppedAttributesCount,
        droppedEventsCount: span.droppedEventsCount,
        droppedLinksCount: span.droppedLinksCount,
    };
}

function enrichSpan(span: ReadableSpan): ReadableSpan {
    try {
        const extra = getGenaiAttributes(span);
        return Object.keys(extra).length ? withAttributes(span, extra) : span;
    } catch (e) {
        consoleLog(`GenaiSemconvSpanExporter| Error adding gen_ai attributes: ${e}`);
        return span;
    }
}

// Adds gen_ai.* attributes at export time, then hands the spans to the wrapped exporter.
export class GenaiSemconvSpanExporter implements SpanExporter {
    constructor(private readonly delegate: SpanExporter) {}

    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        this.delegate.export(spans.map(enrichSpan), resultCallback);
    }

    shutdown(): Promise<void> {
        return this.delegate.shutdown();
    }

    forceFlush(): Promise<void> {
        return this.delegate.forceFlush ? this.delegate.forceFlush() : Promise.resolve();
    }
}


const { ExportResultCode, hrTimeToTimeStamp } = require("@opentelemetry/core");

exports.MonocleConsoleSpanExporter = class MonocleConsoleSpanExporter {

    export(spans, resultCallback) {
        return this._sendSpans(spans, resultCallback);
    }

    shutdown() {
        this._sendSpans([]);
        return this.forceFlush();
    }

    forceFlush() {
        return Promise.resolve();
    }

    _exportInfo(span) {
        const span_object = {
            name: span.name,
            context: span.spanContext(),
            kind: span.kind,
            parent_id: span.parentSpanId,
            instrumentationScope: span.instrumentationLibrary,
            start_time: hrTimeToTimeStamp(span.startTime),
            end_time: hrTimeToTimeStamp(span.endTime),
            status: span.status,
            attributes: span.attributes,
            events: span.events,
            links: span.links,
            resource: {
                attributes: span.resource.attributes,
            },
        };
        if (span_object.events && span_object.events.length > 0) {
            span_object.events = span_object.events.map(event => {
                return {
                    name: event?.name,
                    time: hrTimeToTimeStamp(event.time),
                    attributes: event?.attributes
                }
            });
        }
        return span_object;
    }

    _sendSpans(spans, done) {
        for (const span of spans) {
            console.dir(this._exportInfo(span), { depth: 3 });
        }
        if (done) {
            return done({ code: ExportResultCode.SUCCESS });
        }
    }
}
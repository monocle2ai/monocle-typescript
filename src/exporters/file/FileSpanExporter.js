const fs = require('fs');
const path = require('path');
const { ExportResultCode, hrTimeToMicroseconds } = require('@opentelemetry/core');

class FileSpanExporter {
    constructor({ outPath, file_prefix }) {
        this.outPath = outPath || process.env.MONOCLE_FILE_OUT_PATH || "./";
        this.file_prefix = file_prefix || process.env.MONOCLE_FILE_PREFIX || "monocle_trace__";
        // this.time_format = time_format || process.env.MONOCLE_TIME_FORMAT || "YYYYMMDD_HHmmss";
    }

    export(spans, resultCallback) {
        console.log('exporting spans to file:', spans);
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
        var _a;
        console.log('exporting span:', span);
        return {
            traceId: span.spanContext().traceId,
            parentId: span.parentSpanId,
            traceState: (_a = span.spanContext().traceState) === null || _a === void 0 ? void 0 : _a.serialize(),
            name: span.name,
            spanId: span.spanContext().spanId,
            kind: span.kind,
            startTime: hrTimeToMicroseconds(span.startTime),
            endTime: hrTimeToMicroseconds(span.endTime),
            attributes: span.attributes,
            events: span.events,
            links: span.links,
        };
    }

    async _sendSpans(spans, done) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${this.file_prefix}${timestamp}.json`;
        const filePath = path.join(this.outPath, fileName);
        const body = JSON.stringify(spans.map(span => this._exportInfo(span)));
        console.log('writing spans to file:', filePath, body);

        try {
            console.log('try to write spans to file:', filePath);
            fs.writeFileSync(filePath, body, 'utf8');
            console.log('successfully wrote spans to file:', filePath);
            if (done) {
                return done({ code: ExportResultCode.SUCCESS });
            }
        } catch (error) {
            console.error('Error writing spans to file:', error);
            if (done) {
                return done({ code: ExportResultCode.FAILED, error });
            }
        }
    }
}

exports.FileSpanExporter = FileSpanExporter;

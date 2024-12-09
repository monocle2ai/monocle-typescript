const AWS = require('@aws-sdk/client-s3');
const { ExportResultCode, hrTimeToMicroseconds } = require('@opentelemetry/core');

class AWSS3SpanExporter {
    constructor({ bucketName, keyPrefix, region, fileNameGenerator }) {
        this.bucketName = bucketName || process.env.MONOCLE_S3_BUCKET_NAME || "default-bucket";
        this.keyPrefix = keyPrefix || process.env.MONOCLE_S3_KEY_PREFIX || "monocle_trace__";
        this.s3Client = new AWS.S3({
            region: region || process.env.AWS_S3_REGION || process.env.AWS_REGION
        });
        this.fileNameGenerator = typeof fileNameGenerator == "function" ? fileNameGenerator : () => `${this.keyPrefix}${Date.now().toString()}`;
    }

    export(spans, resultCallback) {
        console.log('exporting spans to S3:', spans);
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
            // resource: {
            //     attributes: span.resource.attributes,
            // },
            // instrumentationScope: span.instrumentationLibrary,
            traceId: span.spanContext().traceId,
            parentId: span.parentSpanId,
            traceState: (_a = span.spanContext().traceState) === null || _a === void 0 ? void 0 : _a.serialize(),
            name: span.name,
            spanId: span.spanContext().spanId,
            kind: span.kind,
            startTime: hrTimeToMicroseconds(span.startTime),
            endTime: hrTimeToMicroseconds(span.endTime),
            attributes: span.attributes,
            // status: span.status,
            events: span.events,
            links: span.links,
        };
    }

    async _sendSpans(spans, done) {
        const timestamp = Date.now().toString()
        const key = `${this.keyPrefix}/${timestamp}.json`;
        const body = JSON.stringify(spans.map(span => this._exportInfo(span)));
        console.log('sending spans to S3:', key, body);

        const params = {
            Bucket: this.bucketName,
            Key: key,
            Body: body,
            ContentType: 'application/json'
        };

        try {
            console.log('try to upload spans to S3:', key);
            await this.s3Client.putObject(params);
            console.log('successfully uploaded spans to S3:', key);
            if (done) {
                return done({ code: ExportResultCode.SUCCESS });
            }
        } catch (error) {
            console.error('Error uploading spans to S3:', error);
            if (done) {
                return done({ code: ExportResultCode.FAILED, error });
            }
        }
    }
}

exports.AWSS3SpanExporter = AWSS3SpanExporter;

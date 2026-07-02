import { S3 } from '@aws-sdk/client-s3';
import { ExportResultCode } from '@opentelemetry/core';
import { getS3FormattedTime, exportInfo } from '../utils';
import { consoleLog } from '../../common/logging';
import { Span } from '@opentelemetry/api';
import { ExportTaskProcessor } from '../taskProcessor/LambdaExportTaskProcessor';

interface AWSS3SpanExporterConfig {
    bucketName?: string;
    keyPrefix?: string;
    region?: string;
    taskProcessor?: ExportTaskProcessor;
}

class AWSS3SpanExporter {
    private bucketName: string;
    private keyPrefix: string;
    private s3Client: S3;
    private taskProcessor?: ExportTaskProcessor;

    constructor({ bucketName, keyPrefix, region, taskProcessor }: AWSS3SpanExporterConfig) {
        this.bucketName = bucketName || process.env.MONOCLE_S3_BUCKET_NAME || "default-bucket";
        this.keyPrefix = keyPrefix || process.env.MONOCLE_S3_KEY_PREFIX || "monocle_trace_";
        this.taskProcessor = taskProcessor;
        if (this.taskProcessor) {
            this.taskProcessor.start();
        }

        consoleLog(`AWSS3SpanExporter| Initializing AWSS3SpanExporter with bucket: ${this.bucketName}, prefix: ${this.keyPrefix}`);

        if (process.env.MONOCLE_AWS_ACCESS_KEY_ID && process.env.MONOCLE_AWS_SECRET_ACCESS_KEY) {
            consoleLog('AWSS3SpanExporter| Initializing S3 client with explicit credentials');
            this.s3Client = new S3({
                region: region || process.env.AWS_S3_REGION || process.env.AWS_REGION,
                credentials: {
                    accessKeyId: process.env.MONOCLE_AWS_ACCESS_KEY_ID || '',
                    secretAccessKey: process.env.MONOCLE_AWS_SECRET_ACCESS_KEY || ''
                }
            });
        } else {
            consoleLog('AWSS3SpanExporter| Initializing S3 client with default credentials');
            this.s3Client = new S3({
                region: region || process.env.AWS_S3_REGION || process.env.AWS_REGION
            });
        }

    }

    export(spans: any, resultCallback: (result: { code: ExportResultCode, error?: Error }) => void): void {
        consoleLog(`AWSS3SpanExporter| Starting export of ${spans.length} spans`);

        if (this.taskProcessor) {
            consoleLog('AWSS3SpanExporter| Using task processor for S3 export');
            this.taskProcessor.queueTask(this._sendSpans.bind(this), spans);
            resultCallback({ code: ExportResultCode.SUCCESS });
            return;
        }

        this._sendSpans(spans, resultCallback);
    }

    shutdown(): Promise<void> {
        return this.forceFlush();
    }

    forceFlush(): Promise<void> {
        return Promise.resolve();
    }

    private _exportInfo(span): object {
        return exportInfo(span);
    }

    private async _sendSpans(spans: Span[], done: (result: { code: ExportResultCode, error?: Error }) => void): Promise<void> {
        const prefix = this.keyPrefix + (process.env.MONOCLE_S3_KEY_PREFIX_CURRENT || '');

        // Group spans by trace id so each trace is uploaded as its own file.
        const spansByTrace = new Map<string, Span[]>();
        for (const span of spans) {
            const traceId = span.spanContext().traceId;
            if (!spansByTrace.has(traceId)) {
                spansByTrace.set(traceId, []);
            }
            spansByTrace.get(traceId).push(span);
        }

        try {
            for (const [traceId, traceSpans] of spansByTrace) {
                const timestamp = getS3FormattedTime(new Date());
                const key = `${prefix}${timestamp}_${traceId}.ndjson`;

                consoleLog(`AWSS3SpanExporter| Preparing to send trace ${traceId} to S3 - Key: ${key}`);

                const body = traceSpans.map(span => JSON.stringify(this._exportInfo(span))).join('\n') + '\n';
                consoleLog(`AWSS3SpanExporter| Generated body size: ${body.length} bytes`);

                const params = {
                    Bucket: this.bucketName,
                    Key: key,
                    Body: body,
                    ContentType: 'application/x-ndjson'
                };

                consoleLog(`AWSS3SpanExporter| Uploading to S3 - Bucket: ${this.bucketName}, Key: ${key}`);
                await this.s3Client.putObject(params);
                consoleLog(`AWSS3SpanExporter| Successfully uploaded trace ${traceId} to S3`);
            }

            if (done) {
                done({ code: ExportResultCode.SUCCESS });
            }
        } catch (error) {
            console.error('Error uploading spans to S3:', error);
            consoleLog(`AWSS3SpanExporter| Failed to upload spans. Error: ${error.message}`);
            if (done) {
                done({ code: ExportResultCode.FAILED, error });
            }
        }
    }
}

export { AWSS3SpanExporter };
import { S3 } from '@aws-sdk/client-s3';
import { ExportResultCode } from '@opentelemetry/core';
import { getUrlFriendlyTime, makeid, exportInfo } from '../utils';
import { consoleLog } from '../../common/logging';
import { Span } from '@opentelemetry/api';
import { ExportTaskProcessor } from '../taskProcessor/LambdaExportTaskProcessor';

interface AWSS3SpanExporterConfig {
    bucketName?: string;
    keyPrefix?: string;
    region?: string;
    taskProcessor?: ExportTaskProcessor;
    // fileNameGenerator?: () => string;
}

class AWSS3SpanExporter {
    private bucketName: string;
    private keyPrefix: string;
    private s3Client: S3;
    private taskProcessor?: ExportTaskProcessor;
    // private fileNameGenerator: () => string;

    constructor({ bucketName, keyPrefix, region, taskProcessor }: AWSS3SpanExporterConfig) {
        this.bucketName = bucketName || process.env.MONOCLE_S3_BUCKET_NAME || "default-bucket";
        this.keyPrefix = keyPrefix || process.env.MONOCLE_S3_KEY_PREFIX || "monocle_trace_";
        this.taskProcessor = taskProcessor;
        
        consoleLog(`AWSS3SpanExporter| Initializing AWSS3SpanExporter with bucket: ${this.bucketName}, prefix: ${this.keyPrefix}`);
        
        if(process.env.MONOCLE_AWS_ACCESS_KEY_ID && process.env.MONOCLE_AWS_SECRET_ACCESS_KEY) {
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
        
        // this.fileNameGenerator = typeof fileNameGenerator === "function" ? fileNameGenerator : () => `${this.keyPrefix}${Date.now().toString()}`;
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
        const timestamp = getUrlFriendlyTime(new Date());
        const prefix = this.keyPrefix + (process.env.MONOCLE_S3_KEY_PREFIX_CURRENT || '');
        const key = `${prefix}${timestamp}_${makeid(5)}.ndjson`;
        
        consoleLog(`AWSS3SpanExporter| Preparing to send spans to S3 - Key: ${key}`);
        consoleLog(`AWSS3SpanExporter| Current prefix: ${prefix}, Timestamp: ${timestamp}`);
        
        const body = spans.map(span => JSON.stringify(this._exportInfo(span))).join('\n');
        consoleLog(`AWSS3SpanExporter| Generated body size: ${body.length} bytes`);

        const params = {
            Bucket: this.bucketName,
            Key: key,
            Body: body,
            ContentType: 'application/x-ndjson'
        };

        try {
            consoleLog(`AWSS3SpanExporter| Uploading to S3 - Bucket: ${this.bucketName}, Key: ${key}`);
            await this.s3Client.putObject(params);
            consoleLog('AWSS3SpanExporter| Successfully uploaded spans to S3');
            done({ code: ExportResultCode.SUCCESS });
        } catch (error) {
            console.error('Error uploading spans to S3:', error);
            consoleLog(`AWSS3SpanExporter| Failed to upload spans. Error: ${error.message}`);
            done({ code: ExportResultCode.FAILED, error });
        }
    }
}

export { AWSS3SpanExporter };
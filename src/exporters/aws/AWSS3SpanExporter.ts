import { S3 } from '@aws-sdk/client-s3';
import { ExportResultCode } from '@opentelemetry/core';
import { getUrlFriendlyTime, makeid, exportInfo } from '../utils';
import { consoleLog } from '../../common/logging';

interface AWSS3SpanExporterConfig {
    bucketName?: string;
    keyPrefix?: string;
    region?: string;
    // fileNameGenerator?: () => string;
}

class AWSS3SpanExporter {
    private bucketName: string;
    private keyPrefix: string;
    private s3Client: S3;
    // private fileNameGenerator: () => string;

    constructor({ bucketName, keyPrefix, region }: AWSS3SpanExporterConfig) {
        this.bucketName = bucketName || process.env.MONOCLE_S3_BUCKET_NAME || "default-bucket";
        this.keyPrefix = keyPrefix || process.env.MONOCLE_S3_KEY_PREFIX || "monocle_trace__";
        this.s3Client = new S3({
            region: region || process.env.AWS_S3_REGION || process.env.AWS_REGION
        });
        // this.fileNameGenerator = typeof fileNameGenerator === "function" ? fileNameGenerator : () => `${this.keyPrefix}${Date.now().toString()}`;
    }

    export(spans: any, resultCallback: (result: { code: ExportResultCode, error?: Error }) => void): void {
        consoleLog(`exporting spans to S3: ${spans}`);
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

    private async _sendSpans(spans, done: (result: { code: ExportResultCode, error?: Error }) => void): Promise<void> {
        const timestamp = getUrlFriendlyTime(new Date());
        const key = `${this.keyPrefix}${timestamp}_${makeid(5)}.json`;
        const body = JSON.stringify(spans.map(span => this._exportInfo(span)));
        consoleLog(`sending spans to S3: ${key} with body: ${body}`);

        const params = {
            Bucket: this.bucketName,
            Key: key,
            Body: body,
            ContentType: 'application/json'
        };

        try {
            consoleLog('try to upload spans to S3:');
            await this.s3Client.putObject(params);
            consoleLog('successfully uploaded spans to S3:');
            done({ code: ExportResultCode.SUCCESS });
        } catch (error) {
            console.error('Error uploading spans to S3:', error);
            done({ code: ExportResultCode.FAILED, error });
        }
    }
}

export { AWSS3SpanExporter };
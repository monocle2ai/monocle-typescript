import { BlobServiceClient } from '@azure/storage-blob';
import { ExportResultCode } from '@opentelemetry/core';
import { exportInfo } from '../utils';
import { consoleLog } from '../../common/logging';
import { Span } from '@opentelemetry/api';

interface AzureBlobSpanExporterConfig {
    containerName?: string;
    blobPrefix?: string;
    connectionString?: string;
    fileNameGenerator?: () => string;
}

class AzureBlobSpanExporter {
    containerName: string;
    blobPrefix: string;
    blobServiceClient: BlobServiceClient;
    fileNameGenerator: () => string;

    constructor({ containerName, blobPrefix, connectionString, fileNameGenerator }: AzureBlobSpanExporterConfig) {
        this.containerName = containerName || process.env.MONOCLE_BLOB_CONTAINER_NAME || "default-container";
        this.blobPrefix = blobPrefix || process.env.MONOCLE_AZURE_BLOB_PREFIX || "monocle_trace__";
        const blobConnectionString = connectionString || process.env.MONOCLE_BLOB_CONNECTION_STRING || process.env.AZURE_STORAGE_CONNECTION_STRING;
        if (!blobConnectionString)
            throw new Error('Azure Blob Storage connection string is required in  MONOCLE_BLOB_CONNECTION_STRING or AZURE_STORAGE_CONNECTION_STRING');
        this.blobServiceClient = BlobServiceClient.fromConnectionString(blobConnectionString);
        this.fileNameGenerator = typeof fileNameGenerator == "function" ? fileNameGenerator : () => `${this.blobPrefix}${Date.now().toString()}`;
    }

    export(spans, resultCallback) {
        consoleLog('exporting spans to Azure Blob Storage:', spans);
        return this._sendSpans(spans, resultCallback);
    }

    shutdown() {
        this._sendSpans([], ()=>{});
        return this.forceFlush();
    }

    forceFlush() {
        return Promise.resolve();
    }

    _exportInfo(span) {
        return exportInfo(span);
    }

    async _sendSpans(spans: Span[], done) {
        const timestamp = Date.now().toString();
        const blobName = `${this.blobPrefix}/${timestamp}.ndjson`;
        const body = spans.map(span => JSON.stringify(this._exportInfo(span))).join('\n');
        consoleLog('sending spans to Azure Blob Storage:', blobName, body);

        const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        try {
            consoleLog('try to upload spans to Azure Blob Storage:', blobName);
            await blockBlobClient.upload(body, body.length, { blobHTTPHeaders: { blobContentType: 'application/x-ndjson' } });
            consoleLog('successfully uploaded spans to Azure Blob Storage:', blobName);
            if (done) {
                return done({ code: ExportResultCode.SUCCESS });
            }
        } catch (error) {
            console.error('Error uploading spans to Azure Blob Storage:', error);
            if (done) {
                return done({ code: ExportResultCode.FAILED, error });
            }
        }
    }
}

const _AzureBlobSpanExporter = AzureBlobSpanExporter;
export { _AzureBlobSpanExporter as AzureBlobSpanExporter };

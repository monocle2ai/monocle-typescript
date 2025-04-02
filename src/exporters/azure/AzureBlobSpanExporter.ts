import { BlobServiceClient } from '@azure/storage-blob';
import { ExportResultCode } from '@opentelemetry/core';
import { exportInfo, getUrlFriendlyTime, makeid } from '../utils';
import { consoleLog } from '../../common/logging';
import { Span } from '@opentelemetry/api';
import { ExportTaskProcessor } from '../taskProcessor/LambdaExportTaskProcessor';

interface AzureBlobSpanExporterConfig {
    containerName?: string;
    blobPrefix?: string;
    connectionString?: string;
    taskProcessor?: ExportTaskProcessor;
}

class AzureBlobSpanExporter {
    containerName: string;
    blobPrefix: string;
    blobServiceClient: BlobServiceClient;
    private taskProcessor?: ExportTaskProcessor;

    constructor({ containerName, blobPrefix, connectionString, taskProcessor }: AzureBlobSpanExporterConfig) {
        this.containerName = containerName || process.env.MONOCLE_BLOB_CONTAINER_NAME || "default-container";
        this.blobPrefix = blobPrefix || process.env.MONOCLE_AZURE_BLOB_PREFIX || "monocle_trace__";
        const blobConnectionString = connectionString || process.env.MONOCLE_BLOB_CONNECTION_STRING || process.env.AZURE_STORAGE_CONNECTION_STRING;
        if (!blobConnectionString)
            throw new Error('Azure Blob Storage connection string is required in  MONOCLE_BLOB_CONNECTION_STRING or AZURE_STORAGE_CONNECTION_STRING');
        this.blobServiceClient = BlobServiceClient.fromConnectionString(blobConnectionString);
        this.taskProcessor = taskProcessor;
        if(this.taskProcessor) {
            this.taskProcessor.start();
        }
    }

    export(spans, resultCallback) {
        consoleLog('exporting spans to Azure Blob Storage:', spans);
        
        if (this.taskProcessor) {
            consoleLog('using task processor for Azure Blob export');
            this.taskProcessor.queueTask(this._sendSpans.bind(this), spans);
            return resultCallback({ code: ExportResultCode.SUCCESS });
        }
        
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
        const timestamp = getUrlFriendlyTime(new Date());
        const blobName = `${this.blobPrefix}${timestamp}_${makeid(5)}.ndjson`;
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

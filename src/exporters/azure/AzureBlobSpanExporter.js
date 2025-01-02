const { BlobServiceClient } = require('@azure/storage-blob');
const { ExportResultCode } = require('@opentelemetry/core');
const { exportInfo } = require('../utils');
const { consoleLog } = require('../../common/logging');

class AzureBlobSpanExporter {
    constructor({ containerName, blobPrefix, connectionString, fileNameGenerator }) {
        this.containerName = containerName || process.env.MONOCLE_BLOB_CONTAINER_NAME || "default-container";
        this.blobPrefix = blobPrefix || process.env.MONOCLE_AZURE_BLOB_PREFIX || "monocle_trace__";
        const connectionString = connectionString || process.env.MONOCLE_BLOB_CONNECTION_STRING || process.env.AZURE_STORAGE_CONNECTION_STRING;
        if (!connectionString)
            throw new Error('Azure Blob Storage connection string is required in  MONOCLE_BLOB_CONNECTION_STRING or AZURE_STORAGE_CONNECTION_STRING');
        this.blobServiceClient = BlobServiceClient.fromConnectionString();
        this.fileNameGenerator = typeof fileNameGenerator == "function" ? fileNameGenerator : () => `${this.blobPrefix}${Date.now().toString()}`;
    }

    export(spans, resultCallback) {
        consoleLog('exporting spans to Azure Blob Storage:', spans);
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
        return exportInfo(span);
    }

    async _sendSpans(spans, done) {
        const timestamp = Date.now().toString();
        const blobName = `${this.blobPrefix}/${timestamp}.json`;
        const body = JSON.stringify(spans.map(span => this._exportInfo(span)));
        consoleLog('sending spans to Azure Blob Storage:', blobName, body);

        const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        try {
            consoleLog('try to upload spans to Azure Blob Storage:', blobName);
            await blockBlobClient.upload(body, body.length, { blobHTTPHeaders: { blobContentType: 'application/json' } });
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

exports.AzureBlobSpanExporter = AzureBlobSpanExporter;

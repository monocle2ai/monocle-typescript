const AWS = require('@aws-sdk/client-s3');
const { ExportResultCode, hrTimeToTimeStamp } = require('@opentelemetry/core');
const { getUrlFriendlyTime, makeid, exportInfo } = require('../utils');
const {consoleLog} = require('../../common/logging');

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
        consoleLog('exporting spans to S3:', spans);
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
        // convert date to format: 2021-09-01_12-00-00-000
        const timestamp = getUrlFriendlyTime(new Date());
        const key = `${this.keyPrefix}${timestamp}_${makeid(5)}.json`;
        const body = JSON.stringify(spans.map(span => this._exportInfo(span)));
        consoleLog('sending spans to S3:', key, body);

        const params = {
            Bucket: this.bucketName,
            Key: key,
            Body: body,
            ContentType: 'application/json'
        };

        try {
            consoleLog('try to upload spans to S3:', key);
            await this.s3Client.putObject(params);
            consoleLog('successfully uploaded spans to S3:', key);
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

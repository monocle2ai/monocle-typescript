const fs = require('fs');
const path = require('path');
const { ExportResultCode } = require('@opentelemetry/core');
const { exportInfo } = require('../utils');
const { consoleLog } = require('../../common/logging');

class FileSpanExporter {
    constructor({ outPath, file_prefix }) {
        this.outPath = outPath || process.env.MONOCLE_FILE_OUT_PATH || "./";
        this.file_prefix = file_prefix || process.env.MONOCLE_FILE_PREFIX || "monocle_trace__";
        // this.time_format = time_format || process.env.MONOCLE_TIME_FORMAT || "YYYYMMDD_HHmmss";
    }

    export(spans, resultCallback) {
        consoleLog('exporting spans to file.');
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
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${this.file_prefix}${timestamp}.json`;
        const filePath = path.join(this.outPath, fileName);
        const body = JSON.stringify(spans.map(span => this._exportInfo(span)));
        consoleLog('writing spans to file:', filePath);

        try {
            consoleLog('try to write spans to file:', filePath);
            fs.writeFileSync(filePath, body, 'utf8');
            consoleLog('successfully wrote spans to file:', filePath);
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

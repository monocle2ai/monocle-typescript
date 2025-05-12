import { writeFileSync } from 'fs';
import { join } from 'path';
import { ExportResultCode } from '@opentelemetry/core';
import { exportInfo } from '../utils';
import { consoleLog } from '../../common/logging';
import { ExportTaskProcessor } from '../taskProcessor/LambdaExportTaskProcessor';

interface FileSpanExporterConfig {
    outPath?: string;
    file_prefix?: string;
    taskProcessor?: ExportTaskProcessor;
}

class FileSpanExporter {
    outPath: string;
    file_prefix: string;
    private taskProcessor?: ExportTaskProcessor;

    constructor({ outPath = "", file_prefix = "", taskProcessor }: FileSpanExporterConfig) {
        this.outPath = outPath || process.env.MONOCLE_FILE_OUT_PATH || "./";
        this.file_prefix = file_prefix || process.env.MONOCLE_FILE_PREFIX || "monocle_trace__";
        this.taskProcessor = taskProcessor;
        if(this.taskProcessor) {
            this.taskProcessor.start();
        }
        // this.time_format = time_format || process.env.MONOCLE_TIME_FORMAT || "YYYYMMDD_HHmmss";
    }

    export(spans, resultCallback) {
        consoleLog('exporting spans to file.');

        const isRootSpan = spans.some((span) => !span.parentSpanId);

        if (this.taskProcessor) {
            consoleLog('using task processor for file export');
            this.taskProcessor.queueTask(() => this._sendSpans(spans, isRootSpan, resultCallback));
            return resultCallback({ code: ExportResultCode.SUCCESS });
        }
        
        return this._sendSpans(spans, isRootSpan, resultCallback);
    }

    shutdown() {
        this._sendSpans([], () => { }, false);
        return this.forceFlush();
    }

    forceFlush() {
        return Promise.resolve();
    }

    _exportInfo(span) {
        return exportInfo(span);
    }

    async _sendSpans(spans, done, isRootSpan = false) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${this.file_prefix}${timestamp}.json`;
        const filePath = join(this.outPath, fileName);
        const body = JSON.stringify({
            is_root_span: isRootSpan,
            spans: spans.map(span => this._exportInfo(span)),
        });
        consoleLog('writing spans to file:', filePath);

        try {
            consoleLog('try to write spans to file:', filePath);
            writeFileSync(filePath, body, 'utf8');
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

const _FileSpanExporter = FileSpanExporter;
export { _FileSpanExporter as FileSpanExporter };

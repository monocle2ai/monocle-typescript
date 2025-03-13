import { ExportResultCode } from "@opentelemetry/core";
import { exportInfo } from "../utils";
import { ExportTaskProcessor } from "../taskProcessor/LambdaExportTaskProcessor";

interface MonocleConsoleSpanExporterConfig {
    taskProcessor?: ExportTaskProcessor;
}

export class MonocleConsoleSpanExporter {
    private taskProcessor?: ExportTaskProcessor;

    constructor(config: MonocleConsoleSpanExporterConfig = {}) {
        this.taskProcessor = config.taskProcessor;
        if(this.taskProcessor) {
            this.taskProcessor.start();
        }
    }

    export(spans, resultCallback) {
        if (this.taskProcessor) {
            this.taskProcessor.queueTask(this._sendSpans.bind(this), spans);
            return resultCallback({ code: ExportResultCode.SUCCESS });
        }
        
        return this._sendSpans(spans, resultCallback);
    }

    shutdown() {
        this._sendSpans([], () => { });
        return this.forceFlush();
    }

    forceFlush() {
        return Promise.resolve();
    }

    _exportInfo(span) {
        return exportInfo(span);
    }

    _sendSpans(spans, done) {
        for (const span of spans) {
            console.log(JSON.stringify(this._exportInfo(span)));
        }
        if (done) {
            return done({ code: ExportResultCode.SUCCESS });
        }
    }
}
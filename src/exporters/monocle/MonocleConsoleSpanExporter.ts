
import { ExportResultCode } from "@opentelemetry/core";
import { exportInfo } from "../utils";

export class MonocleConsoleSpanExporter {

    export(spans, resultCallback) {
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
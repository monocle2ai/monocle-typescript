const { BatchSpanProcessor } = require("@opentelemetry/sdk-trace-node")
const { consoleLog } = require('../../common/logging')   

class PatchedBatchSpanProcessor extends BatchSpanProcessor {
    _maybeStartTimer() {
        if (this._isExporting)
            return;
        const flush = () => {
            this._isExporting = true;
            this._flushOneBatch()
                .finally(() => {
                    this._isExporting = false;
                    if (this._finishedSpans.length > 0) {
                        this._clearTimer();
                        this._maybeStartTimer();
                    }
                })
                .catch(e => {
                    this._isExporting = false;
                    consoleLog(e);
                });
        };
        // we only wait if the queue doesn't have enough elements yet
        if (this._finishedSpans.length >= this._maxExportBatchSize) {
            return flush();
        }
        if (this._timer !== undefined)
            return;
        this._timer = setTimeout(() => flush(), this._scheduledDelayMillis);
        // (0, core_1.unrefTimer)(this._timer);
    }
}

exports.PatchedBatchSpanProcessor = PatchedBatchSpanProcessor
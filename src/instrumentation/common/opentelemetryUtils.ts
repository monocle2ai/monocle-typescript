import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { consoleLog } from '../../common/logging';
import { waitUntil } from "@vercel/functions";

// @ts-ignore: private field access required
class PatchedBatchSpanProcessor extends BatchSpanProcessor {
    _maybeStartTimer() {
        // @ts-ignore: private field access required
        if (this._isExporting)
            return;
        const flush = () => {
            // @ts-ignore: private field access required
            this._isExporting = true;
            // @ts-ignore: private field access required
            const flushPromise = this._flushOneBatch()
            if(process.env.VERCEL_URL) {
                consoleLog('Vercel detected, waiting for spans to be exported');
                waitUntil(flushPromise)
            }

            
            flushPromise
                .finally(() => {
                    // @ts-ignore: private field access required
                    this._isExporting = false;
                    // @ts-ignore: private field access required
                    if (this._finishedSpans.length > 0) {
                        // @ts-ignore: private field access required
                        this._clearTimer();
                        this._maybeStartTimer();
                    }
                })
                .catch(e => {
                    // @ts-ignore: private field access required
                    this._isExporting = false;
                    consoleLog(e);
                });
        };
        // we only wait if the queue doesn't have enough elements yet
        // @ts-ignore: private field access required
        if (this._finishedSpans.length >= this._maxExportBatchSize) {
            return flush();
        }
        // @ts-ignore: private field access required
        if (this._timer !== undefined)
            return;
        // @ts-ignore: private field access required
        // check if the app is deployed on vercel
        if (process.env.VERCEL_URL) {
            consoleLog('Vercel detected, waiting for more spans to be collected before exporting');
            // @ts-ignore: private field access required
            flush()
            return
        }

        // @ts-ignore: private field access required
        this._timer = setTimeout(() => flush(), this._scheduledDelayMillis);
        // (0, core_1.unrefTimer)(this._timer);
    }
}

export { PatchedBatchSpanProcessor }
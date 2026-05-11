import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { consoleLog } from '../../common/logging';
import { waitUntil } from "@vercel/functions";
import { isVercelEnvironment, shouldIncludeNonMonocleSpans } from "./utils";
import { Context, Span as APISpan } from '@opentelemetry/api';
import { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { MONOCLE_SDK_VERSION } from "./constants";

// @ts-ignore: private field access required
class PatchedBatchSpanProcessor extends BatchSpanProcessor {
    // Mirrors Python monocle's skip_export: drop spans that weren't stamped
    // by a Monocle wrapper (e.g. ADK's internal `invocation`, `invoke_agent X`,
    // `call_llm` spans) so they don't clutter the trace output. Bypass with
    // MONOCLE_INCLUDE_ALL_SPANS=true when full visibility is needed.
    onStart(span: APISpan, parentContext: Context): void {
        super.onStart(span as any, parentContext);
    }

    onEnd(span: ReadableSpan): void {
        const isMonocleSpan = !!span.attributes?.[MONOCLE_SDK_VERSION];
        if (!isMonocleSpan && !shouldIncludeNonMonocleSpans()) {
            // Silently drop; do not queue this span for export.
            return;
        }
        super.onEnd(span);
    }

    // @ts-ignore: private field access required
    protected _maybeStartTimer1() {
        // @ts-ignore: private field access required
        if (this._isExporting)
            return;
        const flush = () => {
            // @ts-ignore: private field access required
            this._isExporting = true;
            // @ts-ignore: private field access required
            const flushPromise = this._flushOneBatch()
            if (isVercelEnvironment()) {
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
                        this._maybeStartTimer1();
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
        if (isVercelEnvironment()) {
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
// @ts-ignore: private field access required
PatchedBatchSpanProcessor.prototype._maybeStartTimer = PatchedBatchSpanProcessor.prototype._maybeStartTimer1;

export type Span = APISpan & ReadableSpan;

export { PatchedBatchSpanProcessor }
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import axios, { AxiosInstance } from 'axios';
import { consoleLog } from '../../common/logging';
import { MONOCLE_SDK_VERSION } from '../../instrumentation/common/constants';
import { SpanFilter, SpanFilterConfig } from '../spanFilter';
import { ExportTaskProcessor } from '../taskProcessor/LambdaExportTaskProcessor';

// Sends usage from Monocle inference spans to Paygentic as CloudEvents.
// See https://docs.paygentic.io/integrations/monocle for setup and usage.

const PAYGENTIC_PROD_ENDPOINT = "https://api.paygentic.io/v0/events";
const PAYGENTIC_SANDBOX_ENDPOINT = "https://api.sandbox.paygentic.io/v0/events";
const REQUESTS_SUCCESS_STATUS_CODES = [200, 202];

// Monocle sets scopes as span attributes with a "scope." prefix
// (baggage key "monocle.scope.X" -> span attribute "scope.X").
const SCOPE_CUSTOMER_ID = "scope.customerId";
const SCOPE_EXTERNAL_CUSTOMER_ID = "scope.externalCustomerId";

// How long to suppress an event type the API rejected before trying it again.
const REJECTED_TYPE_COOLDOWN_MS = 3600 * 1000;

const MAX_CONCURRENT_REQUESTS = 10;
const RETRIES = 3;
const BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 32000;

const DEFAULT_SPAN_FILTER_CONFIG: SpanFilterConfig = {
    spanTypesToInclude: ["inference", "inference.*"],
    fieldsToInclude: {
        attributes: ["entity.1.type", "scope.*"],
        events: [{ name: "metadata" }],
    },
};

interface PaygenticSpanExporterConfig {
    endpoint?: string;
    // Request timeout in milliseconds. PAYGENTIC_TIMEOUT is in seconds, as in the Python SDK.
    timeout?: number;
    taskProcessor?: ExportTaskProcessor;
    source?: string;
    namespace?: string;
    sandbox?: boolean;
    // Defaults to inference spans with only `entity.1.type`, `scope.*` attributes and
    // `metadata` events. A custom config must keep `scope.*` in fieldsToInclude.attributes,
    // or no span will have a customer and every span is dropped.
    spanFilterConfig?: SpanFilterConfig;
}

interface CustomerFields {
    subject?: string;
    externalSubject?: string;
}

interface PaygenticEvent extends CustomerFields {
    type: string;
    source: string;
    idempotencyKey: string;
    data: Record<string, any>;
    namespace?: string;
}

// 429s, 5xx responses, timeouts and network errors are worth another attempt.
class RetryableError extends Error { }

export class PaygenticSpanExporter implements SpanExporter {
    private endpoint: string;
    private timeout: number;
    private source: string;
    private namespace?: string;
    private client: AxiosInstance;
    private _closed: boolean = false;
    private taskProcessor?: ExportTaskProcessor;
    private spanFilter: SpanFilter;
    // Event types rejected by the API, mapped to when they were rejected.
    private rejectedTypes = new Map<string, number>();

    constructor(config: PaygenticSpanExporterConfig = {}) {
        const apiKey = process.env.PAYGENTIC_API_KEY;
        if (!apiKey) {
            throw new Error("PAYGENTIC_API_KEY not set.");
        }

        const isSandbox = config.sandbox ?? (process.env.PAYGENTIC_SANDBOX || "").toLowerCase() === "true";
        this.endpoint = config.endpoint
            || process.env.PAYGENTIC_EVENT_ENDPOINT
            || (isSandbox ? PAYGENTIC_SANDBOX_ENDPOINT : PAYGENTIC_PROD_ENDPOINT);
        this.timeout = config.timeout || Number(process.env.PAYGENTIC_TIMEOUT || 15) * 1000;
        this.source = config.source || process.env.PAYGENTIC_SOURCE || "monocle";
        this.namespace = config.namespace || process.env.PAYGENTIC_NAMESPACE;
        this.taskProcessor = config.taskProcessor;
        if (this.taskProcessor) {
            this.taskProcessor.start();
        }
        this.spanFilter = new SpanFilter(config.spanFilterConfig || DEFAULT_SPAN_FILTER_CONFIG);

        consoleLog(`PaygenticSpanExporter| Initializing with endpoint: ${this.endpoint}, timeout: ${this.timeout}`);

        this.client = axios.create({
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            timeout: this.timeout,
            // Status codes are handled in _postSingleEvent.
            validateStatus: () => true
        });
    }

    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        consoleLog(`PaygenticSpanExporter| Attempting to export ${spans.length} spans`);
        if (this._closed) {
            consoleLog("PaygenticSpanExporter| Exporter already shutdown, ignoring batch");
            resultCallback({ code: ExportResultCode.FAILED });
            return;
        }

        const events: PaygenticEvent[] = [];
        for (const span of spans) {
            const event = this._toEvent(span);
            if (event) {
                events.push(event);
            }
        }

        if (events.length === 0) {
            resultCallback({ code: ExportResultCode.SUCCESS });
            return;
        }

        if (this.taskProcessor) {
            consoleLog("PaygenticSpanExporter| Using task processor");
            this.taskProcessor.queueTask(this._sendEvents.bind(this), events);
            resultCallback({ code: ExportResultCode.SUCCESS });
        } else {
            this._sendEvents(events, resultCallback);
        }
    }

    private _toEvent(span: ReadableSpan): PaygenticEvent | null {
        // Only spans Monocle created carry usage.
        if (!span.attributes[MONOCLE_SDK_VERSION]) {
            return null;
        }

        const filtered = this.spanFilter.filter(span);
        if (!filtered) {
            return null;
        }

        const attributes = filtered.attributes || {};
        const traceId = filtered.context?.trace_id || "";
        const spanId = filtered.context?.span_id || "";

        // The span filter has already reduced the events to metadata events.
        const metadata: Record<string, any> = {};
        for (const event of filtered.events || []) {
            Object.assign(metadata, event.attributes);
        }
        if (Object.keys(metadata).length === 0) {
            return null;
        }

        const type = `ai.${attributes["entity.1.type"] ?? "unknown"}`;
        if (this._isTypeRejected(type)) {
            return null;
        }

        const customer = this._resolveCustomer(attributes, filtered.name, traceId);
        if (!customer) {
            return null;
        }

        const event: PaygenticEvent = {
            type,
            source: this.source,
            ...customer,
            idempotencyKey: `${traceId}_${spanId}`,
            data: {
                span_id: spanId,
                trace_id: traceId,
                name: filtered.name,
                ...metadata,
            },
        };
        if (this.namespace) {
            event.namespace = this.namespace;
        }
        return event;
    }

    // Sends the customerId scope as `subject` and the externalCustomerId scope as `externalSubject`.
    private _resolveCustomer(attributes: Record<string, any>, spanName: string, traceId: string): CustomerFields | null {
        const fields: CustomerFields = {};

        const customerId = attributes[SCOPE_CUSTOMER_ID];
        if (customerId) {
            fields.subject = String(customerId);
        }

        const externalCustomerId = attributes[SCOPE_EXTERNAL_CUSTOMER_ID];
        if (externalCustomerId) {
            fields.externalSubject = String(externalCustomerId);
        }

        if (fields.subject || fields.externalSubject) {
            return fields;
        }

        console.error(
            `PaygenticSpanExporter| No customerId or externalCustomerId scope set on span ${spanName} (trace ${traceId}). ` +
            `Set a 'customerId' or 'externalCustomerId' scope with setScopes before the traced call.`
        );
        return null;
    }

    private _isTypeRejected(type: string): boolean {
        const rejectedAt = this.rejectedTypes.get(type);
        if (rejectedAt === undefined) {
            return false;
        }
        if (performance.now() - rejectedAt > REJECTED_TYPE_COOLDOWN_MS) {
            this.rejectedTypes.delete(type);
            consoleLog(`PaygenticSpanExporter| Cooldown expired for event type ${type}, will retry`);
            return false;
        }
        return true;
    }

    private _rejectType(type: string): void {
        if (!this.rejectedTypes.has(type)) {
            console.warn(`PaygenticSpanExporter| Event type ${type} rejected by API, suppressing for ${REJECTED_TYPE_COOLDOWN_MS / 1000}s`);
        }
        this.rejectedTypes.set(type, performance.now());
    }

    private async _sendEvents(events: PaygenticEvent[], resultCallback?: (result: ExportResult) => void): Promise<void> {
        consoleLog(`PaygenticSpanExporter| Sending ${events.length} event(s) to ${this.endpoint}`);

        let failed = 0;
        let next = 0;
        const worker = async () => {
            while (next < events.length) {
                const event = events[next++];
                try {
                    await this._postWithRetry(event);
                } catch (error) {
                    console.error(`PaygenticSpanExporter| Export request failed: ${error.message}`);
                    failed++;
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(events.length, MAX_CONCURRENT_REQUESTS) }, worker));

        if (failed > 0) {
            console.error(`PaygenticSpanExporter| ${failed}/${events.length} event(s) failed`);
            if (resultCallback) {
                resultCallback({ code: ExportResultCode.FAILED });
            }
            return;
        }

        consoleLog(`PaygenticSpanExporter| Successfully exported ${events.length} event(s)`);
        if (resultCallback) {
            resultCallback({ code: ExportResultCode.SUCCESS });
        }
    }

    private async _postWithRetry(event: PaygenticEvent): Promise<void> {
        for (let attempt = 1; attempt <= RETRIES; attempt++) {
            try {
                await this._postSingleEvent(event);
                return;
            } catch (error) {
                if (!(error instanceof RetryableError) || attempt === RETRIES) {
                    throw error;
                }
                const backoff = Math.min(MAX_BACKOFF_MS, BACKOFF_MS * 2 ** (attempt - 1));
                const sleep = backoff * (1 + (Math.random() * 0.2 - 0.1));
                console.warn(
                    `PaygenticSpanExporter| Attempt ${attempt} failed: ${error.message}. ` +
                    `Retrying in ${(sleep / 1000).toFixed(2)} seconds...`
                );
                await new Promise(resolve => setTimeout(resolve, sleep));
            }
        }
    }

    private async _postSingleEvent(event: PaygenticEvent): Promise<void> {
        let response;
        try {
            response = await this.client.post(this.endpoint, event);
        } catch (error) {
            throw new RetryableError(error.message);
        }

        if (response.status === 429) {
            throw new RetryableError("Rate limited");
        }
        if (response.status >= 500) {
            throw new RetryableError(`Server error ${response.status}`);
        }
        if (response.status === 422 && response.data?.error === "invalid_event_type") {
            this._rejectType(event.type);
            return;
        }
        if (!REQUESTS_SUCCESS_STATUS_CODES.includes(response.status)) {
            console.error(`PaygenticSpanExporter| Export failed - Status: ${response.status}, Response: ${JSON.stringify(response.data)}`);
            throw new Error(`Client error ${response.status}`);
        }
    }

    shutdown(): Promise<void> {
        consoleLog("PaygenticSpanExporter| Shutting down exporter");
        if (this._closed) {
            consoleLog("PaygenticSpanExporter| Exporter already shutdown, ignoring call");
            return Promise.resolve();
        }
        this._closed = true;
        return Promise.resolve();
    }

    forceFlush(): Promise<void> {
        return Promise.resolve();
    }
}

import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import axios, { AxiosInstance } from 'axios';
import { consoleLog } from '../../common/logging';
import { exportInfo } from '../utils';


const REQUESTS_SUCCESS_STATUS_CODES = [200, 202];
const OKAHU_PROD_INGEST_ENDPOINT = "https://ingest.okahu.co/api/v1/trace/ingest";

interface OkahuSpanExporterConfig {
    endpoint?: string;
    timeout?: number;
}

export class OkahuSpanExporter implements SpanExporter {
    private endpoint: string;
    private timeout: number;
    private client: AxiosInstance;
    private _closed: boolean = false;

    constructor(config: OkahuSpanExporterConfig = {}) {
        const apiKey = process.env.OKAHU_API_KEY;
        if (!apiKey) {
            throw new Error("OKAHU_API_KEY not set.");
        }

        this.endpoint = config.endpoint || process.env.OKAHU_INGESTION_ENDPOINT || OKAHU_PROD_INGEST_ENDPOINT;
        this.timeout = config.timeout || 15000;

        this.client = axios.create({
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            timeout: this.timeout
        });
    }

    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        if (this._closed) {
            consoleLog("Exporter already shutdown, ignoring batch");
            resultCallback({ code: ExportResultCode.FAILED });
            return;
        }

        if (spans.length === 0) {
            resultCallback({ code: ExportResultCode.SUCCESS });
            return;
        }

        const spanList = {
            batch: spans.map(span => this._exportInfo(span))
        };

        const sendSpansToOkahu = async (spanListLocal: any) => {
            try {
                const result = await this.client.post(this.endpoint, spanListLocal);
                if (!REQUESTS_SUCCESS_STATUS_CODES.includes(result.status)) {
                    console.error(`Traces cannot be uploaded; status code: ${result.status}, message: ${result.data}`);
                    return { code: ExportResultCode.FAILED };
                }
                consoleLog("spans successfully exported to okahu");
                return { code: ExportResultCode.SUCCESS };
            } catch (error) {
                console.error("Trace export failed:", error);
                return { code: ExportResultCode.FAILED };
            }
        };

        sendSpansToOkahu(spanList).then(resultCallback);
    }

    private _exportInfo(span): object {
        return exportInfo(span);
    }

    shutdown(): Promise<void> {
        if (this._closed) {
            consoleLog("Exporter already shutdown, ignoring call");
            return Promise.resolve();
        }
        this._closed = true;
        return Promise.resolve();
    }

    forceFlush(): Promise<void> {
        return Promise.resolve();
    }
}

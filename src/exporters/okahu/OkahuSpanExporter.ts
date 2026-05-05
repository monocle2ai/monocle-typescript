import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import axios, { AxiosInstance } from 'axios';
import { consoleLog } from '../../common/logging';
import { exportInfo } from '../utils';
import { ExportTaskProcessor } from '../taskProcessor/LambdaExportTaskProcessor';


const REQUESTS_SUCCESS_STATUS_CODES = [200, 202];
const OKAHU_PROD_INGEST_ENDPOINT = "https://ingest.okahu.co/api/v1/trace/ingest";

interface OkahuSpanExporterConfig {
    endpoint?: string;
    timeout?: number;
    taskProcessor?: ExportTaskProcessor;
    evaluate?: boolean;
}

export class OkahuSpanExporter implements SpanExporter {
    private endpoint: string;
    private timeout: number;
    private client: AxiosInstance;
    private _closed: boolean = false;
    private taskProcessor?: ExportTaskProcessor;
    private evaluate: boolean;

    constructor(config: OkahuSpanExporterConfig = {}) {
        const apiKey = process.env.OKAHU_API_KEY;
        if (!apiKey) {
            throw new Error("OKAHU_API_KEY not set.");
        }

        this.evaluate = config.evaluate || false;
        this.endpoint = config.endpoint || process.env.OKAHU_INGESTION_ENDPOINT || OKAHU_PROD_INGEST_ENDPOINT;
        if (this.evaluate) {
          this.endpoint = this.endpoint.replace("/trace/ingest", "/eval/ingest");
        }
        this.timeout = config.timeout || 15000;
        this.taskProcessor = config.taskProcessor;
        if(this.taskProcessor) {
            this.taskProcessor.start();
        }
        
        consoleLog(`OkahuSpanExporter| Initializing with endpoint: ${this.endpoint}, timeout: ${this.timeout}`);

        this.client = axios.create({
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            timeout: this.timeout
        });
    }

    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        consoleLog(`OkahuSpanExporter| Attempting to export ${spans.length} spans`);
        consoleLog("OkahuSpanExporter| okahu export start");
        if (this._closed) {
            consoleLog("OkahuSpanExporter| Exporter already shutdown, ignoring batch");
            resultCallback({ code: ExportResultCode.FAILED });
            return;
        }

        if (spans.length === 0) {
            consoleLog("OkahuSpanExporter| no spans to export");
            resultCallback({ code: ExportResultCode.SUCCESS });
            return;
        }

        const spanList = {
            batch: spans.map(span => this._exportInfo(span))
        };

        if (this.taskProcessor) {
            consoleLog("OkahuSpanExporter| Using task processor");
            this.taskProcessor.queueTask(this._sendSpans.bind(this), spanList);
            resultCallback({ code: ExportResultCode.SUCCESS });
        } else {
            this._sendSpans(spanList, resultCallback);
        }
    }

    private _exportInfo(span): object {
        return exportInfo(span);
    }

    private async _sendSpans(spanListLocal: any, resultCallback?: (result: ExportResult) => void): Promise<void> {
        try {
            consoleLog(`OkahuSpanExporter| Sending batch to endpoint: ${this.endpoint}`);
            const result = await this.client.post(this.endpoint, spanListLocal);
            if (!REQUESTS_SUCCESS_STATUS_CODES.includes(result.status)) {
                console.error(`OkahuSpanExporter| Export failed - Status: ${result.status}, Response: ${JSON.stringify(result.data)}`);
                if (resultCallback) {
                    resultCallback({ code: ExportResultCode.FAILED });
                }
                return;
            }
            consoleLog(`OkahuSpanExporter| Successfully exported ${spanListLocal.batch.length} spans`);
            consoleLog("OkahuSpanExporter| spans successfully exported to okahu");
            if (resultCallback) {
                resultCallback({ code: ExportResultCode.SUCCESS });
            }
        } catch (error) {
            console.error("OkahuSpanExporter| Export error:", error.message);
            if (resultCallback) {
                resultCallback({ code: ExportResultCode.FAILED });
            }
        }
    }

    async deleteTrace(
      traceId: string,
      ingestEndpoint?: string,
    ): Promise<boolean> {
      if (this._closed) {
        consoleLog("OkahuSpanExporter| Exporter is closed. Cannot delete trace.");
        return false;
      }

      if (!traceId) {
        throw new Error("traceId is required.");
      }

      const ingest =
        ingestEndpoint ||
        process.env.OKAHU_INGESTION_ENDPOINT ||
        OKAHU_PROD_INGEST_ENDPOINT;
      const deleteUrl = ingest
        .replace(/\/+$/, "")
        .replace("/trace/ingest", "/trace_eval/delete");

      try {
        const result = await this.client.delete(deleteUrl, {
          params: { trace_id: traceId },
        });

        if (!REQUESTS_SUCCESS_STATUS_CODES.includes(result.status)) {
          console.error(
            `OkahuSpanExporter| Delete trace failed - Status: ${result.status}, Response: ${JSON.stringify(result.data)}`,
          );
          return false;
        }
        consoleLog(
          `OkahuSpanExporter| Trace ${traceId} successfully deleted from Okahu.
            Data: ${JSON.stringify(result.data)}
          `,
        );
        return true;
      } catch (error) {
        console.error(
          `OkahuSpanExporter| Failed to delete trace ${traceId}:`,
          error.message,
        );
        if (error.response) {
          console.error(
            `OkahuSpanExporter| Status Code: ${error.response.status}, Response: ${JSON.stringify(error.response.data)}`,
          );
        }
        return false;
      }
    }

    shutdown(): Promise<void> {
        consoleLog("OkahuSpanExporter| Shutting down exporter");
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
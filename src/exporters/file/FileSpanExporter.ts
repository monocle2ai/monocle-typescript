import { existsSync, mkdirSync, WriteStream, createWriteStream } from 'fs';
import { join } from 'path';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { exportInfo } from '../utils';
import { consoleLog } from '../../common/logging';
import { ExportTaskProcessor } from '../taskProcessor/LambdaExportTaskProcessor';

const DEFAULT_FILE_PREFIX = "monocle_trace_";
const DEFAULT_TIME_FORMAT = "YYYY-MM-DD_HH.mm.ss";
const HANDLE_TIMEOUT_SECONDS = 60; // 1 minute timeout

interface FileHandle {
    stream: WriteStream;
    filePath: string;
    creationTime: Date;
    isFirstSpan: boolean;
}

interface FileSpanExporterConfig {
    serviceName?: string;
    outPath?: string;
    filePrefix?: string;
    timeFormat?: string;
    taskProcessor?: ExportTaskProcessor;
    formatter?: (span: ReadableSpan) => string;
}

export class FileSpanExporter implements SpanExporter {
    private outputPath: string;
    private filePrefix: string;
    private timeFormat: string;
    private serviceName?: string;
    private taskProcessor?: ExportTaskProcessor;
    private formatter: (span: ReadableSpan) => string;
    private fileHandles: Map<string, FileHandle> = new Map();

    constructor(config: FileSpanExporterConfig = {}) {
        this.outputPath = config.outPath || process.env.MONOCLE_TRACE_OUTPUT_PATH || "./.monocle";
        this.filePrefix = config.filePrefix || process.env.MONOCLE_FILE_PREFIX || DEFAULT_FILE_PREFIX;
        this.timeFormat = config.timeFormat || process.env.MONOCLE_TIME_FORMAT || DEFAULT_TIME_FORMAT;
        this.serviceName = config.serviceName;
        this.taskProcessor = config.taskProcessor;
        this.formatter = config.formatter || ((span: ReadableSpan) => JSON.stringify(exportInfo(span as any)));
        
        // Create output directory if it doesn't exist
        if (!existsSync(this.outputPath)) {
            mkdirSync(this.outputPath, { recursive: true });
        }

        if (this.taskProcessor) {
            this.taskProcessor.start();
        }
    }

    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        consoleLog('exporting spans to file.');

        const isRootSpan = spans.some((span) => !span.parentSpanContext?.spanId);

        if (this.taskProcessor) {
            consoleLog('using task processor for file export');
            this.taskProcessor.queueTask(() => this._processSpans(spans, isRootSpan));
            resultCallback({ code: ExportResultCode.SUCCESS });
            return;
        }

        this._processSpans(spans, isRootSpan);
        resultCallback({ code: ExportResultCode.SUCCESS });
    }

    shutdown(): Promise<void> {
        consoleLog('FileSpanExporter shutting down');
        if (this.taskProcessor) {
            this.taskProcessor.stop();
        }
        // Close all remaining file handles
        const traceIds = Array.from(this.fileHandles.keys());
        for (const traceId of traceIds) {
            this._closeTraceHandle(traceId);
        }
        return Promise.resolve();
    }

    forceFlush(): Promise<void> {
        consoleLog('FileSpanExporter force flush');
        // Flush all open file handles
        for (const handle of this.fileHandles.values()) {
            try {
                if (handle.stream && !handle.stream.destroyed) {
                    handle.stream.write('\n');
                }
            } catch (error) {
                console.error(`Error flushing file ${handle.filePath}: ${error}`);
            }
        }
        return Promise.resolve();
    }

    private _skipExport(_span: ReadableSpan): boolean {
        return false;
    }

    private _cleanupExpiredHandles(): void {
        const currentTime = new Date();
        const expiredTraceIds: string[] = [];

        for (const [traceId, handle] of this.fileHandles.entries()) {
            const timeDiff = (currentTime.getTime() - handle.creationTime.getTime()) / 1000;
            if (timeDiff > HANDLE_TIMEOUT_SECONDS) {
                expiredTraceIds.push(traceId);
            }
        }

        for (const traceId of expiredTraceIds) {
            this._closeTraceHandle(traceId);
        }
    }

    private _getOrCreateHandle(traceId: string, serviceName: string): FileHandle | null {
        this._cleanupExpiredHandles();

        if (this.fileHandles.has(traceId)) {
            return this.fileHandles.get(traceId)!;
        }

        // Create new handle
        const timestamp = this._formatTimestamp(new Date());
        const fileName = `${this.filePrefix}${serviceName}_${traceId}_${timestamp}.json`;
        const filePath = join(this.outputPath, fileName);

        try {
            const stream = createWriteStream(filePath, { encoding: 'utf8' });
            stream.write('[');
            
            const handle: FileHandle = {
                stream,
                filePath,
                creationTime: new Date(),
                isFirstSpan: true
            };
            
            this.fileHandles.set(traceId, handle);
            return handle;
        } catch (error) {
            console.error(`Error creating file ${filePath}: ${error}`);
            return null;
        }
    }

    private _closeTraceHandle(traceId: string): void {
        const handle = this.fileHandles.get(traceId);
        if (handle) {
            try {
                if (handle.stream && !handle.stream.destroyed) {
                    handle.stream.write(']');
                    handle.stream.end();
                }
            } catch (error) {
                console.error(`Error closing file ${handle.filePath}: ${error}`);
            } finally {
                this.fileHandles.delete(traceId);
            }
        }
    }

    private _markSpanWritten(traceId: string): void {
        const handle = this.fileHandles.get(traceId);
        if (handle) {
            handle.isFirstSpan = false;
        }
    }

    private _formatTimestamp(date: Date): string {
        // Enhanced timestamp formatting based on timeFormat
        // Default format: YYYY-MM-DD_HH.mm.ss
        if (this.timeFormat === DEFAULT_TIME_FORMAT || !this.timeFormat) {
            return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        }
        // Could add more sophisticated formatting based on timeFormat patterns
        return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
    }

    private _processSpans(spans: ReadableSpan[], _isRootSpan: boolean = false): void {
        // Group spans by trace_id for efficient processing
        const spansByTrace = new Map<string, ReadableSpan[]>();
        const rootSpanTraces = new Set<string>();

        for (const span of spans) {
            if (this._skipExport(span)) {
                continue;
            }

            const traceId = span.spanContext().traceId;
            if (!spansByTrace.has(traceId)) {
                spansByTrace.set(traceId, []);
            }
            spansByTrace.get(traceId)!.push(span);

            // Check if this span is a root span
            if (!span.parentSpanContext?.spanId) {
                rootSpanTraces.add(traceId);
            }
        }

        // Process spans for each trace
        for (const [traceId, traceSpans] of spansByTrace.entries()) {
            const serviceName = this._getServiceName(traceSpans[0]);
            const handle = this._getOrCreateHandle(traceId, serviceName);

            if (!handle) {
                continue;
            }

            for (const span of traceSpans) {
                if (!handle.isFirstSpan) {
                    try {
                        handle.stream.write(',');
                    } catch (error) {
                        console.error(`Error writing comma to file ${handle.filePath} for span ${span.spanContext().spanId}: ${error}`);
                        continue;
                    }
                }

                try {
                    const formattedSpan = this.formatter(span);
                    handle.stream.write(formattedSpan);
                    if (handle.isFirstSpan) {
                        this._markSpanWritten(traceId);
                    }
                } catch (error) {
                    console.error(`Error formatting span ${span.spanContext().spanId}: ${error}`);
                    continue;
                }
            }
        }

        // Close handles for traces with root spans
        for (const traceId of rootSpanTraces) {
            this._closeTraceHandle(traceId);
        }

        // Flush remaining handles
        for (const [traceId, handle] of this.fileHandles.entries()) {
            if (!rootSpanTraces.has(traceId)) {
                try {
                    if (handle.stream && !handle.stream.destroyed) {
                        handle.stream.write('\n');
                    }
                } catch (error) {
                    console.error(`Error flushing file ${handle.filePath}: ${error}`);
                }
            }
        }
    }

    private _getServiceName(span: ReadableSpan): string {
        return this.serviceName || 
               span.resource.attributes['service.name'] as string || 
               span.resource.attributes['SERVICE_NAME'] as string || 
               'unknown';
    }
}
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from 'fs';
import { join } from 'path';
import { ExportResultCode } from '@opentelemetry/core';
import { exportInfo } from '../utils';
import { consoleLog } from '../../common/logging';
import { ExportTaskProcessor } from '../taskProcessor/LambdaExportTaskProcessor';

type SpanFormatter = (span: any) => string;

interface FileSpanExporterConfig {
    serviceName?: string;
    outPath?: string;
    file_prefix?: string;
    time_format?: string;
    formatter?: SpanFormatter;
    taskProcessor?: ExportTaskProcessor;
}

const DEFAULT_FILE_PREFIX = "monocle_trace_";
const DEFAULT_TRACE_FOLDER = ".monocle";
const HANDLE_TIMEOUT_MS = 60 * 1000;

interface OpenTraceFile {
    fd: number;
    filePath: string;
    createdAt: number;
    isFirstSpan: boolean;
}

function getParentSpanId(span: any): string | undefined {
    return span?.parentSpanContext?.spanId ?? span?.parentSpanId;
}

function isRootSpan(span: any): boolean {
    const parentId = getParentSpanId(span);
    if (!parentId || parentId === 'None') return true;
    return span?.attributes?.['span.type'] === 'workflow';
}

function formatTimestamp(date: Date): string {
    const pad = (n: number, width = 2) => n.toString().padStart(width, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `_${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
    );
}

class FileSpanExporter {
    outPath: string;
    file_prefix: string;
    time_format: string;
    serviceName?: string;
    lastFileProcessed: string | null = null;
    lastTraceId: string | null = null;
    private formatter: SpanFormatter;
    private taskProcessor?: ExportTaskProcessor;
    private fileHandles: Map<string, OpenTraceFile> = new Map();
    private rootSpanSeen: Set<string> = new Set();

    constructor({
        serviceName,
        outPath = "",
        file_prefix = "",
        time_format = "",
        formatter,
        taskProcessor,
    }: FileSpanExporterConfig = {}) {
        this.serviceName = serviceName;
        this.outPath =
            outPath ||
            process.env.MONOCLE_TRACE_OUTPUT_PATH ||
            process.env.MONOCLE_FILE_OUT_PATH ||
            join(".", DEFAULT_TRACE_FOLDER);
        if (!existsSync(this.outPath)) {
            mkdirSync(this.outPath, { recursive: true });
        }

        this.file_prefix = file_prefix || process.env.MONOCLE_FILE_PREFIX || DEFAULT_FILE_PREFIX;
        this.time_format = time_format || process.env.MONOCLE_TIME_FORMAT || "";
        this.formatter = formatter || ((span) => JSON.stringify(exportInfo(span)));
        this.taskProcessor = taskProcessor;
        if (this.taskProcessor) {
            this.taskProcessor.start();
        }
    }

    setServiceName(serviceName: string): void {
        this.serviceName = serviceName;
    }

    export(spans, resultCallback) {
        consoleLog('exporting spans to file.');

        if (this.taskProcessor) {
            consoleLog('using task processor for file export');
            this.taskProcessor.queueTask(() => this._processSpans(spans, resultCallback));
            return resultCallback({ code: ExportResultCode.SUCCESS });
        }

        return this._processSpans(spans, resultCallback);
    }

    shutdown() {
        if (this.taskProcessor) {
            try {
                this.taskProcessor.stop();
            } catch (error) {
                console.error('Error stopping task processor:', error);
            }
        }
        for (const traceId of Array.from(this.fileHandles.keys())) {
            this._closeTraceHandle(traceId);
        }
        return this.forceFlush();
    }

    forceFlush() {
        return Promise.resolve();
    }

    private _cleanupExpiredHandles() {
        const now = Date.now();
        const expired: string[] = [];
        for (const [traceId, file] of this.fileHandles) {
            if (now - file.createdAt > HANDLE_TIMEOUT_MS) expired.push(traceId);
        }
        for (const traceId of expired) this._closeTraceHandle(traceId);
    }

    private _getOrCreateHandle(traceId: string, serviceName: string): OpenTraceFile | null {
        this._cleanupExpiredHandles();

        const existing = this.fileHandles.get(traceId);
        if (existing) return existing;

        const timestamp = formatTimestamp(new Date());
        const fileName = `${this.file_prefix}${serviceName}_${traceId}_${timestamp}.json`;
        const filePath = join(this.outPath, fileName);

        try {
            const fd = openSync(filePath, 'w');
            writeSync(fd, '[');
            const entry: OpenTraceFile = { fd, filePath, createdAt: Date.now(), isFirstSpan: true };
            this.fileHandles.set(traceId, entry);
            return entry;
        } catch (error) {
            console.error('Error creating trace file:', filePath, error);
            return null;
        }
    }

    private _closeTraceHandle(traceId: string) {
        const entry = this.fileHandles.get(traceId);
        if (!entry) return;
        try {
            writeSync(entry.fd, ']');
            closeSync(entry.fd);
        } catch (error) {
            console.error('Error closing trace file:', entry.filePath, error);
        } finally {
            this.fileHandles.delete(traceId);
            this.lastFileProcessed = entry.filePath;
            this.lastTraceId = traceId;
        }
    }

    private _processSpans(spans, done) {
        try {
            const spansByTrace = new Map<string, any[]>();
            const rootSpanTraces = new Set<string>();

            for (const span of spans) {
                const traceId: string | undefined = span?.spanContext?.().traceId;
                if (!traceId) continue;
                if (!spansByTrace.has(traceId)) spansByTrace.set(traceId, []);
                spansByTrace.get(traceId)!.push(span);
                if (isRootSpan(span)) rootSpanTraces.add(traceId);
            }

            for (const [traceId, traceSpans] of spansByTrace) {
                const serviceName: string =
                    this.serviceName ||
                    (traceSpans[0]?.resource?.attributes?.['service.name'] as string) ||
                    (traceSpans[0]?.resource?.attributes?.SERVICE_NAME as string) ||
                    'unknown';

                const entry = this._getOrCreateHandle(traceId, serviceName);
                if (!entry) continue;

                for (const span of traceSpans) {
                    try {
                        if (!entry.isFirstSpan) writeSync(entry.fd, ',');
                        writeSync(entry.fd, this.formatter(span));
                        entry.isFirstSpan = false;
                    } catch (error) {
                        console.error('Error writing span to file:', entry.filePath, error);
                    }
                }
            }

            const tracesToClose = new Set<string>();
            for (const traceId of rootSpanTraces) {
                const hasChildSpans = (spansByTrace.get(traceId) || []).some((s) => {
                    const pid = getParentSpanId(s);
                    return !!pid && pid !== 'None';
                });
                const entry = this.fileHandles.get(traceId);
                const childrenAlreadyWritten = !!entry && !entry.isFirstSpan;

                if (hasChildSpans || childrenAlreadyWritten) {
                    tracesToClose.add(traceId);
                    this.rootSpanSeen.delete(traceId);
                } else {
                    this.rootSpanSeen.add(traceId);
                }
            }

            for (const traceId of spansByTrace.keys()) {
                if (this.rootSpanSeen.has(traceId) && !rootSpanTraces.has(traceId)) {
                    tracesToClose.add(traceId);
                    this.rootSpanSeen.delete(traceId);
                }
            }

            for (const traceId of tracesToClose) this._closeTraceHandle(traceId);

            if (typeof done === 'function') {
                return done({ code: ExportResultCode.SUCCESS });
            }
        } catch (error) {
            console.error('Error processing spans:', error);
            if (typeof done === 'function') {
                return done({ code: ExportResultCode.FAILED, error });
            }
        }
    }
}

const _FileSpanExporter = FileSpanExporter;
export { _FileSpanExporter as FileSpanExporter };

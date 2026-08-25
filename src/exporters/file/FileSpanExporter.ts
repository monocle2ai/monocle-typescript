import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, writeSync } from 'fs';
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
    idleTimeoutMs?: number;
}

const DEFAULT_FILE_PREFIX = "monocle_trace_";
const DEFAULT_TRACE_FOLDER = ".monocle";
const HANDLE_TIMEOUT_MS = 60 * 1000;
// Backstop for traces that never emit a root span; the normal close happens on
// the root span (see _processSpans). Derived rather than fixed so it always
// exceeds the batch flush interval — if they were equal, every multi-batch trace
// would close between batches and take the reopen path.
const MIN_IDLE_TIMEOUT_MS = 15 * 1000;
function defaultIdleTimeoutMs(): number {
    const batchDelay = parseInt(process.env.MONOCLE_EXPORTER_DELAY ?? '', 10);
    const base = !isNaN(batchDelay) && batchDelay > 0 ? batchDelay : 5000;
    return Math.max(3 * base, MIN_IDLE_TIMEOUT_MS);
}
// Bounds the traceId -> filePath map; oldest evicted first.
const MAX_CLOSED_TRACES = 1000;

interface OpenTraceFile {
    fd: number;
    filePath: string;
    createdAt: number;
    isFirstSpan: boolean;
    // Tracked explicitly: a reopened file starts positioned over the trailing
    // ']', not at end-of-file.
    writeOffset: number;
    // Reopened from an already-closed trace, so late spans are flushed and the
    // file re-closed at once rather than held open.
    reopened?: boolean;
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
    private idleTimeoutMs: number;
    private traceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private _exitHandler?: () => void;
    // Traces already closed, so a late span can reopen and append to the same
    // file instead of starting a second one.
    private closedTraces: Map<string, string> = new Map();

    constructor({
        serviceName,
        outPath = "",
        file_prefix = "",
        time_format = "",
        formatter,
        taskProcessor,
        idleTimeoutMs,
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
        const envIdle = parseInt(process.env.MONOCLE_TRACE_IDLE_MS ?? '', 10);
        this.idleTimeoutMs =
            idleTimeoutMs ?? (!isNaN(envIdle) && envIdle > 0 ? envIdle : defaultIdleTimeoutMs());
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
        for (const timer of this.traceTimers.values()) clearTimeout(timer);
        this.traceTimers.clear();
        this._closeAllHandles();
        this._removeExitHook();
        return this.forceFlush();
    }

    private _closeAllHandles() {
        for (const traceId of Array.from(this.fileHandles.keys())) {
            this._closeTraceHandle(traceId);
        }
    }

    // Nothing calls shutdown() on exit and the idle timer is unref'd, so close
    // synchronously on the way out — writeSync/closeSync are legal in 'exit'.
    private _installExitHook() {
        if (this._exitHandler) return;
        this._exitHandler = () => this._closeAllHandles();
        process.on('exit', this._exitHandler);
        process.on('beforeExit', this._exitHandler);
    }

    private _removeExitHook() {
        if (!this._exitHandler) return;
        process.off('exit', this._exitHandler);
        process.off('beforeExit', this._exitHandler);
        this._exitHandler = undefined;
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

        // Late span on a closed trace (async scorer/eval): append to its file
        // rather than starting a new one.
        const closedPath = this.closedTraces.get(traceId);
        if (closedPath && existsSync(closedPath)) {
            const reopened = this._reopenHandle(traceId, closedPath);
            if (reopened) return reopened;
        }

        // Naming convention unchanged: timestamp is when the trace's file is first created.
        const timestamp = formatTimestamp(new Date());
        const fileName = `${this.file_prefix}${serviceName}_${traceId}_${timestamp}.json`;
        const filePath = join(this.outPath, fileName);

        // The name is second-granular, so if it's already taken, append rather
        // than truncate a completed trace away.
        if (existsSync(filePath)) {
            const reopened = this._reopenHandle(traceId, filePath);
            if (reopened) return reopened;
        }

        try {
            const fd = openSync(filePath, 'w');
            writeSync(fd, '[', 0);
            const entry: OpenTraceFile = {
                fd,
                filePath,
                createdAt: Date.now(),
                isFirstSpan: true,
                writeOffset: 1,
            };
            this.fileHandles.set(traceId, entry);
            this._installExitHook();
            return entry;
        } catch (error) {
            console.error('Error creating trace file:', filePath, error);
            return null;
        }
    }

    // Reopen positioned over the trailing ']' so the next write extends the
    // array instead of clobbering the file.
    private _reopenHandle(traceId: string, filePath: string): OpenTraceFile | null {
        let fd: number | undefined;
        try {
            fd = openSync(filePath, 'r+');
            const size = fstatSync(fd).size;
            if (size < 2) {
                // Not a file we wrote (empty/truncated) — start it over.
                closeSync(fd);
                return null;
            }
            // Byte before the ']' tells us whether the array is still empty.
            const tail = Buffer.alloc(2);
            readSync(fd, tail, 0, 2, size - 2);
            const entry: OpenTraceFile = {
                fd,
                filePath,
                createdAt: Date.now(),
                isFirstSpan: tail.toString('utf8')[0] === '[',
                writeOffset: size - 1, // overwrite the ']'
                reopened: true,
            };
            this.fileHandles.set(traceId, entry);
            this.closedTraces.delete(traceId);
            this._installExitHook();
            consoleLog(`reopened trace file to append late span: ${filePath}`);
            return entry;
        } catch (error) {
            console.error('Error reopening trace file:', filePath, error);
            if (fd !== undefined) {
                try { closeSync(fd); } catch { /* already closed */ }
            }
            return null;
        }
    }

    private _writeToHandle(entry: OpenTraceFile, text: string) {
        writeSync(entry.fd, text, entry.writeOffset);
        entry.writeOffset += Buffer.byteLength(text, 'utf8');
    }

    // A trace is finished once no span has arrived for idleTimeoutMs.
    private _resetIdleTimer(traceId: string) {
        const existing = this.traceTimers.get(traceId);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            this.traceTimers.delete(traceId);
            this._closeTraceHandle(traceId);
        }, this.idleTimeoutMs);
        // Never hold the event loop open on account of a pending trace file.
        if (typeof (timer as any).unref === 'function') (timer as any).unref();
        this.traceTimers.set(traceId, timer);
    }

    private _rememberClosedTrace(traceId: string, filePath: string) {
        this.closedTraces.set(traceId, filePath);
        while (this.closedTraces.size > MAX_CLOSED_TRACES) {
            const oldest = this.closedTraces.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            this.closedTraces.delete(oldest);
        }
    }

    private _closeTraceHandle(traceId: string) {
        const timer = this.traceTimers.get(traceId);
        if (timer) {
            clearTimeout(timer);
            this.traceTimers.delete(traceId);
        }
        const entry = this.fileHandles.get(traceId);
        if (!entry) return;
        try {
            this._writeToHandle(entry, ']');
            closeSync(entry.fd);
        } catch (error) {
            console.error('Error closing trace file:', entry.filePath, error);
        } finally {
            this.fileHandles.delete(traceId);
            this._rememberClosedTrace(traceId, entry.filePath);
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
                        if (!entry.isFirstSpan) this._writeToHandle(entry, ',');
                        this._writeToHandle(entry, this.formatter(span));
                        entry.isFirstSpan = false;
                    } catch (error) {
                        console.error('Error writing span to file:', entry.filePath, error);
                    }
                }

                if (rootSpanTraces.has(traceId) || entry.reopened) {
                    // Root span landed, or a late span on a trace we already
                    // considered finished. Close now so the file is valid JSON
                    // immediately; anything arriving later reopens and appends.
                    this._closeTraceHandle(traceId);
                } else {
                    // No root span yet — hold the file open for the backstop timer.
                    this._resetIdleTimer(traceId);
                }
            }

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

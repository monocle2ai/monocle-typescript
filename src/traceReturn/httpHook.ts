import type { IncomingMessage, ServerResponse } from "http";
import { consoleLog } from "../common/logging";
import { installHttpServerHook, registerHttpRequestHooks } from "../instrumentation/http/serverHook";
import { TRACE_RETURN_REQUEST_HEADER, TRACE_RETURN_RESPONSE_HEADER, TRACE_RETURN_SCOPE_NAME } from "./constants";
import { buildResponseHeaderValue, buildTrailerBytes, makeDelimiter } from "./codec";
import { getTraceReturnExporter } from "./exporter";
import { getHeaderCaseInsensitive, isTraceReturnAuthorized, isTraceReturnEnabled } from "./gate";

const HOOK_INSTALLED = Symbol.for("monocle2ai.traceReturnHttpHook");
const DELIMITER_KEY = Symbol("monocle.traceReturnDelimiter");

// Installed from setupMonocle. Trace return no longer owns the server hook or
// the request span: it registers callbacks with the general HTTP hook, which
// creates the workflow / http.process pair for every request.
export function installTraceReturnHttpHook(): void {
    const g = globalThis as any;
    if (g[HOOK_INSTALLED]) return;
    g[HOOK_INSTALLED] = true;

    registerHttpRequestHooks({ onRequestStart, scopesFor: traceReturnScopes, onBeforeEnd });
    installHttpServerHook();
    consoleLog("[monocle] trace return: trailer hooks registered");
}

function isTraceReturnRequest(req: IncomingMessage): boolean {
    if (!isTraceReturnEnabled()) return false;
    if (getHeaderCaseInsensitive(req.headers, TRACE_RETURN_REQUEST_HEADER) === undefined) return false;
    return isTraceReturnAuthorized(req.headers);
}

// One predicate, deliberately shared with traceReturnScopes: the scope tag and
// the delimiter must be applied to exactly the same requests, or the exporter
// buffers spans no response will ever pop.
function onRequestStart(req: IncomingMessage, res: ServerResponse): void {
    if (!isTraceReturnRequest(req)) {
        if (isTraceReturnEnabled()
            && getHeaderCaseInsensitive(req.headers, TRACE_RETURN_REQUEST_HEADER) !== undefined) {
            consoleLog("[monocle] trace return: request not authorized");
        }
        return;
    }

    // Our write patch runs innermost, so a compression middleware above would
    // hand us gzipped bytes and the plaintext trailer would land after a
    // finished member. Encoders honour accept-encoding, so dropping it is enough.
    delete req.headers["accept-encoding"];

    const delimiter = makeDelimiter();
    (res as any)[DELIMITER_KEY] = delimiter;
    res.setHeader(TRACE_RETURN_RESPONSE_HEADER, buildResponseHeaderValue(delimiter));
    dropContentLength(res);
    patchWriteHead(res);
}

function onBeforeEnd(_req: IncomingMessage, res: ServerResponse, traceId: string): Buffer | null {
    const delimiter = (res as any)[DELIMITER_KEY] as string | undefined;
    if (!delimiter) return null;

    const spans = getTraceReturnExporter().popSpansForTrace(traceId);
    if (!spans.length) {
        consoleLog("[monocle] trace return: no spans buffered for this request");
        return null;
    }
    if (res.getHeader("content-encoding")) {
        // Belt and braces: something encoded the body despite the
        // accept-encoding strip. Send a clean response rather than a corrupt one.
        console.warn("[monocle] trace return: response is content-encoded, skipping trailer.");
        return null;
    }
    return buildTrailerBytes(spans, delimiter);
}

// Appending past a declared Content-Length truncates the response. Dropping it
// falls back to chunked encoding, which — unlike recomputing the length — needs
// no buffering, so streaming still works.
function dropContentLength(res: ServerResponse): void {
    if (res.headersSent) return;
    try { res.removeHeader("Content-Length"); } catch { /* already flushed */ }
}

function patchWriteHead(res: ServerResponse): void {
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = function (this: ServerResponse, ...args: any[]) {
        // Before the call, not after: writeHead stores the header block, and
        // removeHeader can no longer reach it once that has happened. res.end()
        // reaches here through _implicitHeader(), so this covers every path.
        dropContentLength(res);
        const headers = args[args.length - 1];
        if (headers && typeof headers === "object" && !Array.isArray(headers)) {
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === "content-length") delete headers[key];
            }
        }
        return origWriteHead(...(args as [any]));
    } as any;
}

// The scope must be applied only to authorized requests: the exporter buffers
// every span carrying it until a response pops them, so tagging unauthorized
// traffic would fill that buffer with traces nobody claims.
export function traceReturnScopes(req: IncomingMessage): Record<string, string | null> | null {
    if (!isTraceReturnRequest(req)) return null;
    return { [TRACE_RETURN_SCOPE_NAME]: null };
}

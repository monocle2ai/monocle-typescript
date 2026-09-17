// Static imports: a lazy require() throws in the ESM build (see the same note
// in instrumentation.ts). Core modules are process singletons, so patching
// these prototypes reaches every server the app creates.
import * as http from "http";
import * as https from "https";
import type { IncomingMessage, ServerResponse } from "http";
import { context as contextApi } from "@opentelemetry/api";
import { consoleLog } from "../common/logging";
import { TRACE_RETURN_REQUEST_HEADER, TRACE_RETURN_RESPONSE_HEADER } from "./constants";
import { buildResponseHeaderValue, buildTrailerBytes, makeDelimiter } from "./codec";
import { getTraceReturnExporter } from "./exporter";
import { getHeaderCaseInsensitive, isTraceReturnAuthorized, isTraceReturnEnabled } from "./gate";
import { startTraceReturnRequest, TraceReturnRequest } from "./requestSpan";

const HOOK_INSTALLED = Symbol.for("monocle2ai.traceReturnHttpHook");

// Installed from setupMonocle, which runs before the app's import graph loads
// under `--import monocle2ai/register`. Patching the prototype means Express,
// Fastify, Koa, NestJS and `next start` are all covered with no app change.
export function installTraceReturnHttpHook(): void {
    const g = globalThis as any;
    if (g[HOOK_INSTALLED]) return;
    g[HOOK_INSTALLED] = true;

    for (const mod of [http, https] as any[]) {
        const proto = mod?.Server?.prototype;
        if (!proto || typeof proto.emit !== "function") continue;
        patchEmit(proto);
    }
    consoleLog("[monocle] trace return: http server hook installed");
}

function patchEmit(proto: any): void {
    const originalEmit = proto.emit;
    proto.emit = function monocleTraceReturnEmit(this: any, event: string, ...args: any[]) {
        if (event !== "request") return originalEmit.apply(this, [event, ...args]);
        const [req, res] = args as [IncomingMessage, ServerResponse];
        const passthrough = () => originalEmit.apply(this, [event, ...args]);

        try {
            // Three cheap gates before we touch anything. An ordinary request
            // pays one env read and one header lookup.
            if (!isTraceReturnEnabled()) return passthrough();
            if (getHeaderCaseInsensitive(req.headers, TRACE_RETURN_REQUEST_HEADER) === undefined) {
                return passthrough();
            }
            if (!isTraceReturnAuthorized(req.headers)) {
                consoleLog("[monocle] trace return: request not authorized");
                return passthrough();
            }

            // The whole compression problem, solved. Our res.end patch is
            // installed first and therefore runs innermost, so a compression
            // middleware layered above would hand us already-gzipped bytes and
            // our plaintext trailer would land after a finished gzip member.
            // Encoders honour accept-encoding, so removing it here means the
            // response stays plaintext for this one authorized request.
            delete req.headers["accept-encoding"];

            const request = startTraceReturnRequest({
                name: `${req.method} ${stripQuery(req.url)}`,
                attributes: { "http.method": req.method, "http.target": req.url },
            });
            if (!request) return passthrough();

            // Set before anything can flush. The delimiter is random and known
            // up front — it does not depend on the spans — which is what makes
            // streaming responses work.
            const delimiter = makeDelimiter();
            res.setHeader(TRACE_RETURN_RESPONSE_HEADER, buildResponseHeaderValue(delimiter));
            installTrailer(res, request, delimiter);

            return contextApi.with(request.context, passthrough);
        } catch (e) {
            // A tracing feature must never take a request down.
            console.warn(`[monocle] trace return hook failed, serving request untouched: ${e}`);
            return passthrough();
        }
    };
}

function stripQuery(url?: string): string {
    if (!url) return "";
    const q = url.indexOf("?");
    return q === -1 ? url : url.slice(0, q);
}

function installTrailer(res: ServerResponse, request: TraceReturnRequest, delimiter: string): void {
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    const origWriteHead = res.writeHead.bind(res);
    let finished = false;

    // Appending bytes past a declared Content-Length truncates the response or
    // hangs the connection. Dropping it entirely falls back to chunked encoding,
    // which costs nothing and — unlike recomputing the length — does not require
    // buffering the body, so SSE and streaming still work.
    const dropContentLength = () => {
        if (res.headersSent) return;
        try { res.removeHeader("Content-Length"); } catch { /* already flushed */ }
    };

    // writeHead(status, headers) sets headers that removeHeader may not reach,
    // so strip it out of the argument too.
    res.writeHead = function (this: ServerResponse, ...args: any[]) {
        const headers = args[args.length - 1];
        if (headers && typeof headers === "object" && !Array.isArray(headers)) {
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === "content-length") delete headers[key];
            }
        }
        const out = origWriteHead(...(args as [any]));
        dropContentLength();
        return out;
    } as any;

    // Pass-through, not buffering: the body streams to the client as normal.
    res.write = function (this: ServerResponse, ...args: any[]) {
        dropContentLength();
        return (origWrite as any)(...args);
    } as any;

    res.end = function (this: ServerResponse, chunk?: any, encoding?: any, callback?: any) {
        // end(cb) / end(chunk, cb) / end(chunk, encoding, cb)
        if (typeof chunk === "function") { callback = chunk; chunk = undefined; encoding = undefined; }
        else if (typeof encoding === "function") { callback = encoding; encoding = undefined; }

        if (finished) return (origEnd as any)(chunk, encoding, callback);
        finished = true;

        try {
            dropContentLength();
            if (chunk !== undefined && chunk !== null) (origWrite as any)(chunk, encoding);

            // Ends the root span BEFORE popping. SimpleSpanProcessor hands it
            // over synchronously, so the request's own span makes it into its
            // own payload — which Python's version never manages.
            request.end({ httpStatus: res.statusCode });

            const spans = getTraceReturnExporter().popSpansForTrace(request.traceId);
            if (!spans.length) {
                consoleLog("[monocle] trace return: no spans buffered for this request");
            } else if (res.getHeader("content-encoding")) {
                // Belt and braces: something encoded the body despite the
                // accept-encoding strip. Send a clean response rather than a
                // corrupt one.
                console.warn(
                    "[monocle] trace return: response is content-encoded, skipping trailer.",
                );
            } else {
                (origWrite as any)(buildTrailerBytes(spans, delimiter));
            }
        } catch (e) {
            console.warn(`[monocle] trace return: could not append trailer: ${e}`);
        }
        return (origEnd as any)(callback);
    } as any;
}

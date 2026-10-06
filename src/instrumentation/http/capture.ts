import { performance } from "perf_hooks";
import {
    HTTP_CAPTURE_KEY, HTTP_ORIGINAL_URL_KEY, HttpCapture, MAX_DATA_LENGTH, MAX_STREAMING_CAPTURE_LENGTH,
    StreamEndReason,
} from "./constants";

// Content types whose bytes are text. An unset content-type counts as textual:
// a handler that writes before setting one is almost always writing JSON.
const TEXTUAL_CONTENT_TYPE =
    /^(?:text\/|application\/(?:json|xml|javascript|x-www-form-urlencoded|[a-z0-9.+-]*\+json))/;

function headerValue(req: any, name: string): string | undefined {
    const value = req?.headers?.[name];
    return Array.isArray(value) ? value[0] : value;
}

// Exported so excludePaths.ts shares this definition of "the path without a
// query string" rather than drifting from it with its own copy.
export function stripQuery(url: string): string {
    const q = url.indexOf("?");
    return q === -1 ? url : url.slice(0, q);
}

// Byte-truncates before decoding so a large Buffer is never materialised as a
// string. Four bytes per character is the UTF-8 worst case.
function decodeCapped(buf: Buffer, limit: number): string {
    return buf.subarray(0, limit * 4).toString("utf8");
}

export function stringifyBody(value: unknown, limit: number): string {
    if (value === undefined || value === null) return "";
    let text: string;
    if (typeof value === "string") text = value;
    else if (Buffer.isBuffer(value)) text = decodeCapped(value, limit);
    else {
        try {
            text = JSON.stringify(value) ?? "";
        } catch {
            return ""; // circular or non-serialisable: an empty attribute beats a throw
        }
    }
    return text.length > limit ? text.slice(0, limit) : text;
}

export function getMethod(req: any): string {
    return typeof req?.method === "string" ? req.method : "";
}

// Called by the server hook at request start, before any framework can rewrite
// req.url. A symbol, like HTTP_CAPTURE_KEY on the response: invisible to
// Object.keys and JSON.stringify, so the application never sees it.
export function rememberOriginalUrl(req: any, url: string): void {
    try {
        req[HTTP_ORIGINAL_URL_KEY] = url;
    } catch { /* frozen request object: fall back to req.url below */ }
}

// The request target as it arrived. req.url alone is the mount-relative path
// inside a mounted router, a sub-app or middleware such as express.static,
// which is what these accessors would otherwise read at res.end.
function requestTarget(req: any): string {
    const original = req?.[HTTP_ORIGINAL_URL_KEY];
    if (typeof original === "string") return original;
    return typeof req?.url === "string" ? req.url : "";
}

// req.route is set by Express when a route matches, and baseUrl by a mounted
// router. Reading them is duck typing, not a dependency: absent, we degrade to
// the concrete path rather than failing.
export function getRoute(req: any): string {
    const routePath = req?.route?.path;
    if (typeof routePath === "string" && routePath.length > 0) {
        const base = typeof req?.baseUrl === "string" ? req.baseUrl : "";
        const joined = `${base}${routePath}`;
        return joined.length > 1 && joined.endsWith("/") ? joined.slice(0, -1) : joined;
    }
    return stripQuery(requestTarget(req));
}

export function getUrl(req: any): string {
    const local = req?.socket?.encrypted === true ? "https" : "http";
    // Client-controlled, so only the two schemes this hook can serve are
    // honoured: anything else would put arbitrary text into entity.1.url.
    const forwarded = headerValue(req, "x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
    const scheme = forwarded === "http" || forwarded === "https" ? forwarded : local;
    const host = headerValue(req, "host") || "localhost";
    return `${scheme}://${host}${requestTarget(req)}`;
}

export function getParams(req: any): string {
    const url = typeof req?.url === "string" ? req.url : "";
    const q = url.indexOf("?");
    return q === -1 ? "" : url.slice(q + 1);
}

export function getRequestBody(req: any): string {
    return stringifyBody(req?.body, MAX_DATA_LENGTH);
}

export function getStatusCode(res: any): string {
    const code = res?.statusCode;
    return typeof code === "number" && code > 0 ? String(code) : "";
}

export function getResponseBody(res: any): string {
    const capture = res?.[HTTP_CAPTURE_KEY] as HttpCapture | undefined;
    return capture?.body ?? "";
}

function isTextualResponse(res: any): boolean {
    let contentType = "";
    let contentEncoding = "";
    try {
        contentType = String(res?.getHeader?.("content-type") ?? "").toLowerCase();
        contentEncoding = String(res?.getHeader?.("content-encoding") ?? "").trim().toLowerCase();
    } catch {
        return true;
    }
    // A compression middleware leaves content-type alone, so the encoding is the
    // only signal that these bytes are not the text the type claims.
    if (contentEncoding && contentEncoding !== "identity") return false;
    return contentType === "" || TEXTUAL_CONTENT_TYPE.test(contentType);
}

// Called from the response patches for every chunk. Copy-and-forward: the
// caller always writes the chunk on regardless, so streaming is never delayed.
// The cap is cumulative, so a long SSE stream stops growing the capture.
// Created on first use rather than at request start: `truncated` is decided by
// the content-type, which a handler has usually not set yet when the request
// arrives. Both the body capture and the stream counter come through here, so
// whichever runs first settles that question for both.
function ensureCapture(res: any): HttpCapture | undefined {
    const existing = res[HTTP_CAPTURE_KEY] as HttpCapture | undefined;
    if (existing) return existing;
    const capture: HttpCapture = { body: "", truncated: !isTextualResponse(res), chunks: 0 };
    try {
        res[HTTP_CAPTURE_KEY] = capture;
    } catch {
        return undefined; // frozen response object: capture nothing, serve normally
    }
    return capture;
}

function chunkHasBytes(chunk: unknown): boolean {
    if (typeof chunk === "string") return chunk.length > 0;
    // Covers Buffer, which is a Uint8Array, as well as a bare typed array.
    if (ArrayBuffer.isView(chunk)) return chunk.byteLength > 0;
    return false;
}

export function appendResponseChunk(res: any, chunk: unknown): void {
    if (chunk === undefined || chunk === null || !res) return;
    const capture = ensureCapture(res);
    if (!capture) return;
    if (capture.truncated) return;

    const remaining = MAX_STREAMING_CAPTURE_LENGTH - capture.body.length;
    if (remaining <= 0) {
        capture.truncated = true;
        return;
    }
    const text =
        typeof chunk === "string" ? chunk
        : Buffer.isBuffer(chunk) ? decodeCapped(chunk, remaining)
        // A Web ReadableStream yields plain Uint8Arrays, so this is what every
        // Next.js route handler streaming a Response ends up writing.
        // Buffer.isBuffer is false for one, and its own toString() would render
        // "100,97,116,97" rather than text, so it has to go through a Buffer
        // view - which wraps the same memory rather than copying it.
        : ArrayBuffer.isView(chunk)
            ? decodeCapped(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), remaining)
        : "";
    if (text.length >= remaining) {
        capture.body += text.slice(0, remaining);
        capture.truncated = true;
    } else {
        capture.body += text;
    }
}

// ---- stream shape -------------------------------------------------------
// Deliberately NOT folded into appendResponseChunk: that function returns early
// for a non-textual response, so counting there would lose the shape of every
// streamed download. A stream is still a stream when we decline to read it.

// One res.write() that carried bytes. The caller decides what counts as a
// stream write; this only records it.
export function recordStreamChunk(res: any, chunk: unknown): void {
    if (!res || !chunkHasBytes(chunk)) return;
    const capture = ensureCapture(res);
    if (!capture) return;
    capture.chunks += 1;
    if (capture.firstByteAt === undefined) capture.firstByteAt = performance.now();
}

// "Did the handler stream this response?" - the one question the end-of-request
// status and the three stream attributes all turn on. A plain res.end(body)
// never calls recordStreamChunk, so it answers false.
export function didStream(res: any): boolean {
    const capture = res?.[HTTP_CAPTURE_KEY] as HttpCapture | undefined;
    return (capture?.chunks ?? 0) > 0;
}

// Called once from the hook before the metamodel runs. The accessors below are
// pure reads, so anything derived has to be on the capture by then.
export function recordStreamEnd(res: any, endReason: StreamEndReason, startedAt: number): void {
    const capture = res?.[HTTP_CAPTURE_KEY] as HttpCapture | undefined;
    // No capture, or nothing ever written: there is no stream to describe, and
    // the three attributes stay off the span entirely.
    if (!capture || capture.chunks === 0) return;
    capture.endReason = endReason;
    if (capture.firstByteAt !== undefined) {
        // Microsecond resolution, not whole milliseconds: processSpan drops
        // falsy accessor results, so a TTFB that rounded to 0 would silently
        // vanish from the span. Reaching the first write within 500ns of span
        // start is not reachable here - span creation and handler dispatch sit
        // in between - but rounding to integers would make it merely unlikely.
        capture.timeToFirstByteMs = Math.round((capture.firstByteAt - startedAt) * 1000) / 1000;
    }
}

export function getStreamChunkCount(res: any): number | undefined {
    const capture = res?.[HTTP_CAPTURE_KEY] as HttpCapture | undefined;
    // undefined, not 0: the three stream attributes are emitted as a set or not
    // at all, and 0 would be dropped by processSpan anyway.
    return capture?.chunks ? capture.chunks : undefined;
}

export function getStreamEndReason(res: any): string | undefined {
    return (res?.[HTTP_CAPTURE_KEY] as HttpCapture | undefined)?.endReason;
}

export function getTimeToFirstByteMs(res: any): number | undefined {
    return (res?.[HTTP_CAPTURE_KEY] as HttpCapture | undefined)?.timeToFirstByteMs;
}

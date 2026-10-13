import {
    HTTP_CAPTURE_KEY, HTTP_ORIGINAL_URL_KEY, HttpCapture, MAX_DATA_LENGTH, MAX_STREAMING_CAPTURE_LENGTH,
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
export function appendResponseChunk(res: any, chunk: unknown): void {
    if (chunk === undefined || chunk === null || !res) return;
    let capture = res[HTTP_CAPTURE_KEY] as HttpCapture | undefined;
    if (!capture) {
        capture = { body: "", truncated: !isTextualResponse(res) };
        try {
            res[HTTP_CAPTURE_KEY] = capture;
        } catch {
            return; // frozen response object: capture nothing, serve normally
        }
    }
    if (capture.truncated) return;

    const remaining = MAX_STREAMING_CAPTURE_LENGTH - capture.body.length;
    if (remaining <= 0) {
        capture.truncated = true;
        return;
    }
    const text =
        typeof chunk === "string" ? chunk
        : Buffer.isBuffer(chunk) ? decodeCapped(chunk, remaining)
        : "";
    if (text.length >= remaining) {
        capture.body += text.slice(0, remaining);
        capture.truncated = true;
    } else {
        capture.body += text;
    }
}

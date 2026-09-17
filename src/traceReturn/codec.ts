import {randomUUID} from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import { ReadableSpan, Span } from "@opentelemetry/sdk-trace-base";
import {
    TRACE_RETURN_DELIMITER_PREFIX,
    TRACE_RETURN_DELIMITER_SUFFIX,
    TRACE_RETURN_VERSION,
} from "./constants";
import { toLoaderSpan } from "./toLoaderSpan";

//Wire format, fixed by monocle_apptrace's trace_return.py. 
// body <response body><delimiter><payload>
// header x-monocle-traces: v1; delim=<delimiter>
// payload base64(gzip(json array of loader shaped spans))

// The gzip bytes need not match Python's byte-for-byte — the client decompresses
// rather than compares, and Node defaults to level 6 where Python uses 9. What
// must match exactly: the delimiter shape, the header grammar, and standard
// padded base64 (Buffer's "base64" and Python's b64encode use the same alphabet).

const DELIM_MARKER = "delim=";

// Mirrors uuid.uuid4().hex — 32 lowercase hex chars, no dashes. The value is
// never validated by the client, only string-matched, so what matters is that
// 128 random bits make a collision with body content unreachable.
export function makeDelimiter(): string {
    const hex = randomUUID().replace(/-/g, "");
    return `${TRACE_RETURN_DELIMITER_PREFIX}${hex}${TRACE_RETURN_DELIMITER_SUFFIX}`;
}

export function encodeSpans(spans: ReadableSpan[]): string {
    // exportInfo()'s parameter is typed as the SDK Span class but only ever reads
    // ReadableSpan members; the other exporters hand it untyped spans for the
    // same reason.
    const payload = spans.map((span) => toLoaderSpan(span as Span));
    return gzipSync(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64");
}

export function decodePayload(payload: string): string {
    return gunzipSync(Buffer.from(payload, "base64")).toString("utf8");
}

export function buildTrailerBytes(spans: ReadableSpan[], delimiter: string): Buffer {
    return Buffer.concat([
        Buffer.from(delimiter, "utf8"),
        Buffer.from(encodeSpans(spans), "ascii"),
    ]);
}

export function buildResponseHeaderValue(delimiter: string): string {
    return `${TRACE_RETURN_VERSION}; ${DELIM_MARKER}${delimiter}`;
}


// ------------- client-side halves -----------------------------------------
// Python's HttpRunner owns these in production. Keeping them here makes the
// codec round-trip testable without standing up a Python client, and gives the
// step-10 integration test something to check Python's answer against.

export function parseDelimiterFromHeader(headerValue: string): string | null {
    if (!headerValue) return null;
    // indexOf + slice, not split("delim="): Python uses split(..., 1) so
    // everything after the FIRST marker is the delimiter. JS's split()[1] would
    // instead stop at a second occurrence.
    const idx = headerValue.indexOf(DELIM_MARKER);
    if (idx === -1) return null;
    return headerValue.slice(idx + DELIM_MARKER.length).trim();
}

export function splitBodyAndTrailer(
    body: Buffer,
    delimiter: string,
): { clean: Buffer; payload: string | null } {
    const marker = Buffer.from(delimiter, "utf8");
    // Byte-level search, so a multibyte UTF-8 body splits without corruption.
    const idx = body.indexOf(marker);
    if (idx === -1) return { clean: body, payload: null };
    return {
        clean: body.subarray(0, idx),
        payload: body.subarray(idx + marker.length).toString("ascii"),
    };
}
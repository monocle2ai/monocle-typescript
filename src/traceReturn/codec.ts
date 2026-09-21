import {randomUUID} from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import { ReadableSpan, Span } from "@opentelemetry/sdk-trace-base";
import {
    TRACE_RETURN_DELIMITER_PREFIX,
    TRACE_RETURN_DELIMITER_SUFFIX,
    TRACE_RETURN_VERSION,
} from "./constants";
import { toLoaderSpan } from "./toLoaderSpan";

// Wire format, fixed by monocle_apptrace's trace_return.py:
//   body    <response body><delimiter><payload>
//   header  x-monocle-traces: v1; delim=<delimiter>
//   payload base64(gzip(json array of loader-shaped spans))

const DELIM_MARKER = "delim=";

// Mirrors uuid.uuid4().hex: 32 lowercase hex chars. Only string-matched by the
// client, so all that matters is that 128 random bits never collide with a body.
export function makeDelimiter(): string {
    const hex = randomUUID().replace(/-/g, "");
    return `${TRACE_RETURN_DELIMITER_PREFIX}${hex}${TRACE_RETURN_DELIMITER_SUFFIX}`;
}

export function encodeSpans(spans: ReadableSpan[]): string {
    // exportInfo() types its parameter as the SDK Span class but reads only
    // ReadableSpan members; the other exporters cast the same way. The gzip bytes
    // need not match Python's — the client decompresses rather than compares.
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
// Python's HttpRunner owns these in production; keeping them here makes the
// codec round-trip testable without standing up a Python client.

export function parseDelimiterFromHeader(headerValue: string): string | null {
    if (!headerValue) return null;
    // indexOf + slice, not split: Python's split(..., 1) keeps everything after
    // the FIRST marker; JS's split()[1] would stop at a second occurrence.
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

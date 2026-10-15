// Caps match monocle_apptrace's MAX_DATA_LENGTH and MAX_STREAMING_CAPTURE_LENGTH
// so a TypeScript span truncates where an upstream one would.
export const MAX_DATA_LENGTH = 1000;
export const MAX_STREAMING_CAPTURE_LENGTH = 5000;

// The accumulated response body lives on the ServerResponse: the metamodel
// accessors are pure reads, so whatever they need must already be there.
export const HTTP_CAPTURE_KEY = Symbol("monocle.httpCapture");

// Express rewrites req.url to the mount-relative path for the duration of a
// mounted router or middleware, and the accessors run at res.end, inside that
// rewrite. The hook stashes the original request target here at request start.
export const HTTP_ORIGINAL_URL_KEY = Symbol("monocle.httpOriginalUrl");

// Why the server ended up finishing the response. Only ever set on a response
// that streamed - see recordStreamEnd in capture.ts.
//
// "error" is distinct from "client_closed" on purpose: a disconnect is normal
// for a stream and is not reported as a failure, so without separating the two
// a server-side blow-up mid-stream would be indistinguishable from a reader
// who simply closed the tab.
export type StreamEndReason = "complete" | "client_closed" | "error";

export interface HttpCapture {
    body: string;
    truncated: boolean;
    // Stream shape and timing, recorded independently of the body above: a
    // non-textual response suppresses body capture, but how many chunks it sent
    // and when the first one left are still worth knowing.
    chunks: number;
    firstByteAt?: number;
    // Derived once at res.end / close, because the metamodel accessors are pure
    // reads and cannot compute anything themselves.
    endReason?: StreamEndReason;
    timeToFirstByteMs?: number;
}

// Comma-separated path prefixes served with no hook involvement at all. Keeps
// probe traffic out of the trace, and is the only lever for keeping a
// credential endpoint's body out of an exporter, since bodies are not redacted.
export const MONOCLE_HTTP_EXCLUDE_PATHS_ENV = "MONOCLE_HTTP_EXCLUDE_PATHS";

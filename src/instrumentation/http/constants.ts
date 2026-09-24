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

export interface HttpCapture {
    body: string;
    truncated: boolean;
}

// Comma-separated path prefixes served with no hook involvement at all. Keeps
// probe traffic out of the trace, and is the only lever for keeping a
// credential endpoint's body out of an exporter, since bodies are not redacted.
export const MONOCLE_HTTP_EXCLUDE_PATHS_ENV = "MONOCLE_HTTP_EXCLUDE_PATHS";

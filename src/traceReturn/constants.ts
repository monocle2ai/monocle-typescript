// Contract for HTTP trace return (span piggyback in the response body). Every
// key here mirrors monocle_test_tools exactly, because that is the client. If
// the two drift, the feature breaks silently — the client just sees no traces.


// Master switch. Off unless explicitely "true" (case-sensitive).
export const MONOCLE_TRACE_RETURN_ENABLED_ENV="MONOCLE_ENABLE_TRACE_RETURN";

//Request header carrying the caller's retrieval key. its presence asks for trace; its value is what auth gate checks.
export const TRACE_RETURN_REQUEST_HEADER="x-monocle-retrieve-traces";

//Response header announcing that a trailer follows, as "v1; delim=<delimiter>".
export const TRACE_RETURN_RESPONSE_HEADER="x-monocle-traces";

// Scope tagged onto the request. Lands on every span as `scope.monocle_trace_return`
// (see spanHandler.setMonocleAttributes), which is how the exporter decides a span
// is eligible to be returned at all.
export const TRACE_RETURN_SCOPE_NAME="monocle_trace_return";
export const TRACE_RETURN_SCOPE_ATTRIBUTE=`scope.${TRACE_RETURN_SCOPE_NAME}`;

//Payload format version, emitted in res header value.
export const TRACE_RETURN_VERSION="v1";

// Authorization. CALLBACK overrides the default key check; the callback spec is
// resolved once at setup here (Node's import() is async) rather than per-request
// as monocle_apptrace does with importlib.
export const MONOCLE_TRACE_RETRIEVAL_CALLBACK_ENV="MONOCLE_TRACE_RETRIEVAL_CALLBACK";
export const MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY_ENV="MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY";

// Boundary between the real response body and the span payload:
// <body><delimiter><base64(gzip(spans))>
export const TRACE_RETURN_DELIMITER_PREFIX="__MONOCLE_TRACES__";
export const TRACE_RETURN_DELIMITER_SUFFIX="__";
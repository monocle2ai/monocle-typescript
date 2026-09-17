// Public surface for HTTP trace return.
//
// Nothing here is needed for the normal path: with MONOCLE_ENABLE_TRACE_RETURN
// set, setupMonocle installs the http hook and the feature is entirely automatic.
// These exports exist for adapters the hook cannot reach — AWS Lambda, Azure
// Functions, Web Request/Response runtimes — where you own the response object
// and have to assemble the trailer yourself.

export { installTraceReturnHttpHook } from "./httpHook";
export { startTraceReturnRequest } from "./requestSpan";
export type { TraceReturnRequest, StartTraceReturnRequestOptions } from "./requestSpan";

export { getTraceReturnExporter, TraceReturnSpanExporter } from "./exporter";

export {
    makeDelimiter,
    encodeSpans,
    decodePayload,
    buildTrailerBytes,
    buildResponseHeaderValue,
    parseDelimiterFromHeader,
    splitBodyAndTrailer,
} from "./codec";

export { isTraceReturnEnabled, isTraceReturnAuthorized, getHeaderCaseInsensitive } from "./gate";
export type { TraceReturnHeaders, TraceRetrievalCallback } from "./gate";

export { toLoaderSpan } from "./toLoaderSpan";
export type { LoaderSpan } from "./toLoaderSpan";

export {
    TRACE_RETURN_REQUEST_HEADER,
    TRACE_RETURN_RESPONSE_HEADER,
    TRACE_RETURN_SCOPE_NAME,
    TRACE_RETURN_VERSION,
} from "./constants";

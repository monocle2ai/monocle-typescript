// Public surface for HTTP trace return. Nothing here is needed normally — with
// MONOCLE_ENABLE_TRACE_RETURN set, setupMonocle installs the hook and the
// feature is automatic. These exist for adapters the hook cannot reach (Lambda,
// Azure Functions, Web Request/Response), where you assemble the trailer.

export { installTraceReturnHttpHook } from "./httpHook";

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

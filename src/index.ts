import { setupMonocle, setScopes, setScopesBind, startTrace } from "./instrumentation/common/instrumentation";
import { PatchedBatchSpanProcessor } from "./instrumentation/common/opentelemetryUtils";
import { traceMethod, monocleTraceMethod, monocleTrace } from "./instrumentation/common/customSpans";
import { buildCustomSpanProcessor, CUSTOM_SPAN_PROCESSOR } from "./instrumentation/common/customSpanProcessor";

export { setupMonocle, setScopes, setScopesBind, startTrace, PatchedBatchSpanProcessor };
export { traceMethod, monocleTraceMethod, monocleTrace, buildCustomSpanProcessor, CUSTOM_SPAN_PROCESSOR };
export type { TraceMethodOptions, MonocleTraceOptions } from "./instrumentation/common/customSpans";

// Namespaced rather than flattened: trace return is opt-in and automatic, so
// these belong out of the way of the everyday API.
export * as traceReturn from "./traceReturn";

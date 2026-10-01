import { setupMonocle, setScopes, setScopesBind, startTrace } from "./instrumentation/common/instrumentation";
import { PatchedBatchSpanProcessor } from "./instrumentation/common/opentelemetryUtils";

export { setupMonocle, setScopes, setScopesBind, startTrace, PatchedBatchSpanProcessor };

// Namespaced rather than flattened: trace return is opt-in and automatic, so
// these belong out of the way of the everyday API.
export * as traceReturn from "./traceReturn";

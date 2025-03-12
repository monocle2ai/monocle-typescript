import { setupMonocle, setScopes, setScopesBind, startTrace } from "./instrumentation/common/instrumentation";
import { PatchedBatchSpanProcessor } from "./instrumentation/common/opentelemetryUtils";

export { setupMonocle, setScopes, setScopesBind, startTrace, PatchedBatchSpanProcessor };
import { setupMonocle, setScopes, setScopesBind } from "./instrumentation/common/instrumentation";
import { PatchedBatchSpanProcessor } from "./instrumentation/common/opentelemetryUtils";

export { setupMonocle, setScopes, setScopesBind, PatchedBatchSpanProcessor};
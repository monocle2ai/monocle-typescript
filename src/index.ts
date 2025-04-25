import { setupMonocle, setScopes, setScopesBind, startTrace, attachHeadersScopes } from "./instrumentation/common/instrumentation";
import { PatchedBatchSpanProcessor } from "./instrumentation/common/opentelemetryUtils";

export { setupMonocle, setScopes, setScopesBind, startTrace, PatchedBatchSpanProcessor, attachHeadersScopes };
 
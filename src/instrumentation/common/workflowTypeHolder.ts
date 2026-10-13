import { WORKFLOW_TYPE_GENERIC } from "./constants";

// The HTTP server hook opens the workflow span before any framework code runs,
// so the type is unknown at creation. Context is immutable, so a value set
// inside the handler cannot travel back out — this mutable holder is the channel.
// Symbol.for, like HOOKS_KEY in http/serverHook.ts: the ESM and CJS builds have
// separate module state, and the hook writes this key while spanHandler reads
// it. Two plain Symbols would never match, and every workflow span would keep
// the generic type.
export const WORKFLOW_TYPE_HOLDER_KEY = Symbol.for("monocle.workflowTypeHolder");

export interface WorkflowTypeHolder {
    type: string | null;
}

export function createWorkflowTypeHolder(): WorkflowTypeHolder {
    return { type: null };
}

// First non-generic wins: the outermost framework names the workflow, and a
// nested one must not rename it.
export function recordWorkflowType(holder: WorkflowTypeHolder | undefined, type: unknown): void {
    if (!holder || typeof holder !== "object" || holder.type) return;
    if (typeof type === "string" && type && type !== WORKFLOW_TYPE_GENERIC) {
        holder.type = type;
    }
}

export function resolveWorkflowType(holder: WorkflowTypeHolder | undefined): string {
    return holder?.type ?? WORKFLOW_TYPE_GENERIC;
}

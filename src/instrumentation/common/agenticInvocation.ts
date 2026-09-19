import { Context, trace } from "@opentelemetry/api";
import { MONOCLE_ACTIVE_SPAN_KEY } from "./constants";
import { Span } from "./opentelemetryUtils";

// Publishes the agent invocation a framework has open, so a model-API span
// created by another metamodel can nest under it.
//
// Nesting normally comes from function wrapping: each wrapper makes its span
// current, so the next call down attaches to it. A framework whose per-agent
// step is only observable through events breaks that chain — the invocation
// span is never current, so nothing underneath can find it.
//
// Keyed by the turn span, which both sides can reach. Concurrent runs sit on
// different turn spans, so they never collide.

export interface OpenAgentInvocation {
    span: Span;
    // Copied onto the child span, so the two correlate by scope as well as by
    // parent.
    scopeId?: string;
}

const openInvocations = new Map<Span, OpenAgentInvocation>();

export function setOpenAgentInvocation(turn: Span, invocation: OpenAgentInvocation) {
    openInvocations.set(turn, invocation);
}

export function clearOpenAgentInvocation(turn: Span) {
    openInvocations.delete(turn);
}

// Undefined when no agentic run is live, which leaves non-agentic calls
// unchanged.
export function getOpenAgentInvocation(currentContext: Context): OpenAgentInvocation | undefined {
    if (!currentContext || typeof currentContext.getValue !== "function") {
        return undefined;
    }
    const current = (currentContext.getValue(MONOCLE_ACTIVE_SPAN_KEY) as Span)
        || (trace.getSpan(currentContext) as Span | undefined);
    return current ? openInvocations.get(current) : undefined;
}

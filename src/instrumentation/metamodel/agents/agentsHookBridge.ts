import { Context, SpanStatusCode, Tracer, context, trace } from "@opentelemetry/api";
import { Span } from "../../common/opentelemetryUtils";
import {
    MONOCLE_ACTIVE_SPAN_KEY,
    SCOPE_AGENTIC_INVOCATION,
    WrapperArguments,
} from "../../common/constants";
import { DefaultSpanHandler } from "../../common/spanHandler";
import { clearOpenAgentInvocation, setOpenAgentInvocation } from "../../common/agenticInvocation";
import { getScopeFromContext, updateBaggageContextWithScopes } from "../../common/utils";
import { consoleLog } from "../../../common/logging";
import { AGENT } from "./entities/agentInvocation";
import { TOOL } from "./entities/tools";

// Turns the agents SDK's RunHooks lifecycle events into Monocle spans, since
// Runner.run exposes no per-agent method to patch. The Runner emits all of these
// on itself:
//   agent_start(runContext, agent, turnInput?)
//   agent_end(runContext, agent, output)
//   agent_handoff(runContext, fromAgent, toAgent)
//   agent_tool_start(runContext, agent, tool, { toolCall })
//   agent_tool_end(runContext, agent, tool, result, { toolCall })
//
// One activation is tracked at a time. A handoff replaces it: the delegating
// agent receives no agent_end, so agent_handoff ends its activation and carries
// the provenance forward. Nested activations (agent.asTool()) are out of scope.
//
// Spans take an explicit parent: a listener returns immediately, so it cannot
// wrap the agent's later work in a context.with frame.

const INVOCATION_SPAN_NAME = "openai_agents.agent";
const TOOL_SPAN_NAME = "openai_agents.tool";

interface InvocationRecord {
    span: Span;
    // Retained so attributes are read with this activation's scopes active, and
    // so tool spans nest under it.
    spanContext: Context;
    scopeId?: string;
    agent: any;
    turnInput: any;
    handoffFrom?: { fromAgent: string; fromAgentSpanId: string };
}

interface ToolRecord {
    span: Span;
    spanContext: Context;
    tool: any;
    toolCall: any;
    agent: any;
}

interface RunState {
    tracer: Tracer;
    element: WrapperArguments;
    // Absent when skipSpan suppressed the turn span; activations then parent to
    // whatever encloses them.
    turn?: Span;
    invocation?: InvocationRecord;
    // Written by agent_handoff, consumed by the next agent_start.
    pendingHandoff?: { fromAgent: string; fromAgentSpanId: string };
    // Keyed by toolCall.callId: tool calls can run in parallel and complete out
    // of order, so start/end correlate by id rather than by recency.
    tools: Map<string, ToolRecord>;
}

// Keyed by the turn span, which is one per Runner.run call. The RunContext is
// NOT the run's identity: the SDK reuses an app-supplied one verbatim, so two
// sequential runs can share it and the second would inherit the first run's
// ended turn span.
const statesByTurn = new Map<Span, RunState>();

// Only for runs with no turn span (skipSpan suppressed it), where there is
// nothing else to key on. Weak, so a finished run's state is collectable.
const statesByRunContext = new WeakMap<object, RunState>();

// One listener set per Runner: the module-level run() reuses a singleton Runner,
// so attaching per call would leak listeners or detach them from a live run.
const wiredRunners = new WeakSet<object>();

const spanHandler = new DefaultSpanHandler();

// Safe to read from the active context: events are emitted synchronously inside
// the awaited call chain of the patched Runner.run, and AsyncHooksContextManager
// carries the context across those awaits.
function activeTurnSpan(): Span | undefined {
    const active = context.active();
    const monocleSpan = active.getValue(MONOCLE_ACTIVE_SPAN_KEY) as Span | undefined;
    return monocleSpan || (trace.getSpan(active) as Span | undefined);
}

// Resolves the run's state, creating it on the first event.
function stateFor(runContext: any, element: WrapperArguments, tracer: Tracer):
    RunState | undefined {
    const turn = activeTurnSpan();
    if (turn) {
        let state = statesByTurn.get(turn);
        if (!state) {
            state = { tracer, element, turn, tools: new Map() };
            statesByTurn.set(turn, state);
        }
        return state;
    }

    // No turn span: the RunContext is all there is to group events by.
    if (!runContext || typeof runContext !== "object") return undefined;
    let state = statesByRunContext.get(runContext);
    if (!state) {
        state = { tracer, element, tools: new Map() };
        statesByRunContext.set(runContext, state);
    }
    return state;
}

// Republishes the open activation for the model-API span, which is
// created by another metamodel and cannot discover it on its own.
function publishCurrentInvocation(state: RunState) {
    if (!state.turn) return;
    if (state.invocation) {
        setOpenAgentInvocation(state.turn, {
            span: state.invocation.span,
            scopeId: state.invocation.scopeId,
        });
    } else {
        clearOpenAgentInvocation(state.turn);
    }
}

// Runs a bridge-created span through the same pipeline as a wrapped call, so
// entities, events and scopes behave identically.
function fillAndEnd(
    span: Span,
    spanContext: Context,
    state: RunState,
    outputProcessor: any,
    instance: any,
    args: any[],
    returnValue: any,
) {
    try {
        // context.with is required: scopes are read off the globally active
        // baggage (getScopesInternal), not from a passed-in context.
        context.with(spanContext, () => {
            spanHandler.setDefaultMonocleAttributes({
                span,
                instance,
                args: args as any,
                element: state.element,
                sourcePath: "",
            });
            spanHandler.processSpan({
                span,
                instance,
                args: args as any,
                returnValue,
                outputProcessor,
                wrappedPackage: state.element.package,
            });
        });
    } catch (e) {
        consoleLog(`Warning: error filling agents span: ${e}`);
    } finally {
        span.end();
    }
}

function openInvocation(state: RunState, agent: any, turnInput: any) {
    // Activations hang off the turn, or off the ambient context when skipSpan
    // suppressed the turn span.
    const parentContext = state.turn
        ? trace.setSpan(context.active(), state.turn)
        : context.active();

    // Each activation is its own invocation scope. null → auto-generate.
    const spanContext = updateBaggageContextWithScopes(parentContext, {
        [SCOPE_AGENTIC_INVOCATION]: null,
    });
    const span = state.tracer.startSpan(INVOCATION_SPAN_NAME, {}, spanContext) as Span;

    state.invocation = {
        span,
        spanContext,
        scopeId: getScopeFromContext(spanContext, SCOPE_AGENTIC_INVOCATION),
        agent,
        turnInput,
        handoffFrom: state.pendingHandoff,
    };
    state.pendingHandoff = undefined;
    publishCurrentInvocation(state);
}

// Returns the closed record so a handoff can stamp its span id on the next
// activation.
function closeInvocation(state: RunState, result: Record<string, any>): InvocationRecord | undefined {
    const invocation = state.invocation;
    if (!invocation) return undefined;
    state.invocation = undefined;
    publishCurrentInvocation(state);
    fillAndEnd(
        invocation.span,
        invocation.spanContext,
        state,
        [AGENT],
        invocation.agent,
        [invocation.agent, invocation.turnInput],
        {
            ...result,
            fromAgent: invocation.handoffFrom?.fromAgent,
            fromAgentSpanId: invocation.handoffFrom?.fromAgentSpanId,
        },
    );
    return invocation;
}

function closeTool(state: RunState, record: ToolRecord, result: Record<string, any>) {
    fillAndEnd(
        record.span,
        record.spanContext,
        state,
        [TOOL],
        record.tool,
        [record.toolCall, record.agent],
        result,
    );
}

// Tool spans nest under the calling agent, falling back to the turn if no
// activation is open.
function openTool(state: RunState, agent: any, tool: any, toolCall: any) {
    const invocation = state.invocation;
    const parentSpan = invocation?.span || state.turn;
    const baseContext = invocation?.spanContext || context.active();
    const spanContext = parentSpan
        ? trace.setSpan(baseContext, parentSpan)
        : baseContext;
    const span = state.tracer.startSpan(TOOL_SPAN_NAME, {}, spanContext) as Span;

    const callId = toolCall?.callId || toolCall?.id;
    const record: ToolRecord = { span, spanContext, tool, toolCall, agent };
    if (callId) {
        state.tools.set(String(callId), record);
    } else {
        // Nothing to correlate on, so close now rather than leak a span that
        // agent_tool_end could never match.
        closeTool(state, record, {});
    }
}

// Closes anything still open and drops the run's state.
export function endRun(turn: Span) {
    const state = statesByTurn.get(turn);
    if (!state) return;
    statesByTurn.delete(turn);
    clearOpenAgentInvocation(turn);

    for (const record of state.tools.values()) {
        record.span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "run ended before the tool completed",
        });
        closeTool(state, record, {});
    }
    state.tools.clear();

    if (state.invocation) {
        state.invocation.span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "run ended before the agent completed",
        });
        closeInvocation(state, {});
    }
}

export function attachRunnerHooks(runner: any, element: WrapperArguments, tracer: Tracer) {
    if (!runner || typeof runner.on !== "function") return;
    if (wiredRunners.has(runner)) return;
    wiredRunners.add(runner);

    // A tracing failure must never break the app's run.
    const guard = (name: string, fn: () => void) => {
        try {
            fn();
        } catch (e) {
            consoleLog(`Warning: agents ${name} hook failed: ${e}`);
        }
    };

    runner.on("agent_start", (runContext: any, agent: any, turnInput?: any) => {
        guard("agent_start", () => {
            const state = stateFor(runContext, element, tracer);
            if (!state) return;
            // Only an unsupported nested activation arrives with one already
            // open. Close it rather than leak the span, recording no handoff.
            if (state.invocation) {
                closeInvocation(state, {});
            }
            openInvocation(state, agent, turnInput);
        });
    });

    runner.on("agent_end", (runContext: any, _agent: any, output: any) => {
        guard("agent_end", () => {
            const state = stateFor(runContext, element, tracer);
            if (!state) return;
            closeInvocation(state, { output });
        });
    });

    runner.on("agent_tool_start", (runContext: any, agent: any, tool: any, details: any) => {
        guard("agent_tool_start", () => {
            const state = stateFor(runContext, element, tracer);
            if (!state) return;
            openTool(state, agent, tool, details?.toolCall);
        });
    });

    runner.on("agent_tool_end", (runContext: any, _agent: any, _tool: any, result: any, details: any) => {
        guard("agent_tool_end", () => {
            const state = stateFor(runContext, element, tracer);
            if (!state) return;
            const callId = details?.toolCall?.callId || details?.toolCall?.id;
            const record = callId ? state.tools.get(String(callId)) : undefined;
            if (!record) return;
            state.tools.delete(String(callId));
            closeTool(state, record, { result });
        });
    });

    // Ends the delegating agent's activation and holds its provenance for the
    // next agent_start, the delegated agent.
    runner.on("agent_handoff", (runContext: any, fromAgent: any, toAgent: any) => {
        guard("agent_handoff", () => {
            const state = stateFor(runContext, element, tracer);
            if (!state) return;
            const fromName = fromAgent?.name || state.invocation?.agent?.name || "";
            const closed = closeInvocation(state, { handoffTo: toAgent?.name || "" });
            if (closed) {
                state.pendingHandoff = {
                    fromAgent: fromName,
                    fromAgentSpanId: closed.span.spanContext().spanId,
                };
            }
        });
    });
}

import { context, Tracer } from "@opentelemetry/api";
import {
    FROM_AGENT_KEY,
    FROM_AGENT_SPAN_ID_KEY,
    MASTRA_AGENT_NAME_KEY,
    MASTRA_TURN_SPAN_ACTIVE_KEY,
    MONOCLE_ACTIVE_SPAN_KEY,
    SCOPE_AGENTIC_INVOCATION,
    SCOPE_AGENTIC_SESSION,
    SCOPE_AGENTIC_TURN,
    WrapperArguments,
} from "../../common/constants";
import { DefaultSpanHandler } from "../../common/spanHandler";
import { getScopeFromContext, updateBaggageContextWithScopes } from "../../common/utils";
import { getPatchedMain } from "../../common/wrapper";
import { TOOL } from "./entities/tool";

// Best-effort read of an app-supplied session/thread id from the agent call
// options (args[1]). Monocle never fabricates one — if the app doesn't pass it,
// the session scope stays unset. Field names mirror Mastra's memory options;
// confirm against the installed @mastra/core version during the e2e in Task 4.
function extractSessionId(callArgs: any): string | undefined {
    const options = callArgs?.[1];
    if (!options) return undefined;
    const thread = options.memory?.thread;
    if (typeof thread === "string") return thread;
    if (typeof thread?.id === "string") return thread.id;
    if (typeof options.threadId === "string") return options.threadId;
    if (typeof options.resourceId === "string") return options.resourceId;
    return undefined;
}

export class MastraTurnSpanHandler extends DefaultSpanHandler {
    // Suppress duplicate agentic.turn spans. The outermost generate()/stream()
    // call opens the turn span and stamps MASTRA_TURN_SPAN_ACTIVE_KEY; any
    // nested agent invocation sees the key and bails out before opening its own
    // span. The original method still runs — only span creation is skipped.
    skipSpan(): boolean {
        return context.active().getValue(MASTRA_TURN_SPAN_ACTIVE_KEY) === true;
    }

    preTracing(_: WrapperArguments, currentContext: any, _thisArg?: any, callArgs?: any): any {
        currentContext = currentContext.setValue(MASTRA_TURN_SPAN_ACTIVE_KEY, true);

        const scopes: Record<string, string | null> = {};
        // Session comes from the app; never overwrite an inherited one, never
        // synthesize a missing one.
        const sessionId = extractSessionId(callArgs);
        if (!getScopeFromContext(currentContext, SCOPE_AGENTIC_SESSION) && sessionId) {
            scopes[SCOPE_AGENTIC_SESSION] = sessionId;
        }
        // Turn: one agent call → one turn id. Only generate when nothing's on
        // the context (outermost call wins), so nested calls share the id.
        if (!getScopeFromContext(currentContext, SCOPE_AGENTIC_TURN)) {
            scopes[SCOPE_AGENTIC_TURN] = null; // null → auto-generate id
        }

        currentContext = updateBaggageContextWithScopes(currentContext, scopes);
        return currentContext;
    }

    // stream() returns a MastraModelOutput synchronously, before generation
    // finishes. getFullOutput() resolves when the run completes and yields the
    // aggregated FullOutput ({ text, ... }); it is non-destructive (Mastra
    // buffers/replays chunks so the app can still read its own textStream).
    // The common wrapper (Task 3) uses this to defer ending the span until the
    // stream is done. generate() returns a Promise and does not need this.
    resolveCompletion({ returnValue }: { returnValue: any }): Promise<any> | null {
        if (returnValue && typeof returnValue.getFullOutput === "function") {
            return returnValue.getFullOutput();
        }
        return null;
    }
}

// One span per agent activation, nested inside the turn span. The turn handler
// suppresses every nested call; this one suppresses only same-agent re-entry, so
// a delegated sub-agent still gets its own span.
function agentNameOf(agent: any): string {
    return agent?.name || agent?.id || "mastra_agent";
}

export class MastraInvocationSpanHandler extends DefaultSpanHandler {
    // Mastra re-enters its own public methods within one activation (e.g.
    // runStreamUntilIdle calls agent.stream again), which otherwise doubles the
    // span. Re-delegating to the same sub-agent is unaffected — by then the
    // context has unwound and the delegator is active again.
    skipSpan({ instance }: any = {}): boolean {
        return context.active().getValue(MASTRA_AGENT_NAME_KEY) === agentNameOf(instance);
    }

    preTracing(_: WrapperArguments, currentContext: any, thisArg?: any, _callArgs?: any): any {
        const self = agentNameOf(thisArg);

        // Whoever was active before us is our delegator; read before claiming.
        const prevAgent = currentContext.getValue(MASTRA_AGENT_NAME_KEY) as string | undefined;
        if (prevAgent && prevAgent !== self) {
            currentContext = currentContext.setValue(FROM_AGENT_KEY, prevAgent);
            const prevSpan: any = currentContext.getValue(MONOCLE_ACTIVE_SPAN_KEY);
            const prevSpanId = prevSpan?.spanContext?.()?.spanId;
            if (prevSpanId) {
                currentContext = currentContext.setValue(FROM_AGENT_SPAN_ID_KEY, prevSpanId);
            }
        }

        currentContext = currentContext.setValue(MASTRA_AGENT_NAME_KEY, self);
        // Always a fresh id — a nested agent run is a separate invocation.
        currentContext = updateBaggageContextWithScopes(currentContext, {
            [SCOPE_AGENTIC_INVOCATION]: null, // null -> auto-generate
        });
        return currentContext;
    }

    // As with the turn span, stream() resolves its final output later.
    resolveCompletion({ returnValue }: { returnValue: any }): Promise<any> | null {
        if (returnValue && typeof returnValue.getFullOutput === "function") {
            return returnValue.getFullOutput();
        }
        return null;
    }
}

const MONOCLE_WRAPPED = "_monocleWrapped";

// Mastra exposes each sub-agent as an `agent-<key>` tool (see listAgentTools in
// @mastra/core src/agent/agent.ts), so delegation surfaces as a tool call. That
// span is Mastra plumbing sitting between the delegating agent's invocation and
// the sub-agent's, so we skip it — the sub-agent then parents straight to its
// delegator, matching how ADK nests delegated agents.
//
// Keys come from listAgents() rather than an "agent-" prefix test, so a
// user-defined tool that happens to start with "agent-" is still traced.
function delegationToolKeys(agent: any): Set<string> {
    try {
        const subAgents = typeof agent?.listAgents === "function" ? agent.listAgents({}) : null;
        if (!subAgents || typeof subAgents !== "object" || typeof subAgents.then === "function") {
            return new Set();
        }
        return new Set(Object.keys(subAgents).map((k) => `agent-${k}`));
    } catch {
        return new Set(); // never let tracing break tool setup
    }
}

// Wraps each tool's execute in the map Agent.convertTools returns, since Mastra
// tools expose no prototype method to patch. Mutating the map is safe: Mastra's
// wrapToolWithHooks hands back `{...tool, execute}`, a fresh copy per call.
//
// A wrapperMethod replaces the call (see _patchMainMethodName), so this must
// invoke `wrapped` itself; convertTools is async, hence the promise chain.
export function mastraToolWrapper(
    tracer: Tracer,
    _spanHandler: any,
    element: any,
    wrapped: Function,
    instance: any,
    _sourcePath: string,
    args: any[],
) {
    return Promise.resolve(wrapped.apply(instance, args)).then((tools: any) => {
        if (!tools || typeof tools !== "object") return tools;

        const agentStamp = { name: instance?.name || "", id: instance?.id || "" };
        const delegationTools = delegationToolKeys(instance);

        for (const toolName of Object.keys(tools)) {
            if (delegationTools.has(toolName)) continue;
            const tool = tools[toolName];
            const originalExecute = tool?.execute;
            if (typeof originalExecute !== "function") continue;
            // convertTools runs per turn, and the agent-as-tool path re-enters it
            // with the same objects, so guard against stacking wrappers.
            if ((originalExecute as any)[MONOCLE_WRAPPED]) continue;

            // Accessors only ever receive the tool as `instance`, never the Agent,
            // so the agent has to travel on the tool. Non-enumerable to stay out
            // of tool serialization.
            Object.defineProperty(tool, "__monocleAgent", {
                value: agentStamp,
                enumerable: false,
                configurable: true,
                writable: true,
            });

            const toolElement = {
                tracer,
                package: element?.package || "@mastra/core/agent",
                object: "Tool",
                method: "execute",
                spanName: "mastra.tool",
                output_processor: [TOOL],
            };

            const wrappedExecute = getPatchedMain(toolElement as any)(originalExecute);
            (wrappedExecute as any)[MONOCLE_WRAPPED] = true;
            tool.execute = wrappedExecute;
        }

        return tools;
    });
}

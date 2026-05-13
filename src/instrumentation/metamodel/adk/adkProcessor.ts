import { context } from "@opentelemetry/api";
import {
    ADK_AGENT_NAME_KEY,
    ADK_TURN_SPAN_ACTIVE_KEY,
    FROM_AGENT_KEY,
    FROM_AGENT_SPAN_ID_KEY,
    MONOCLE_ACTIVE_SPAN_KEY,
    WrapperArguments,
} from "../../common/constants";
import { DefaultSpanHandler } from "../../common/spanHandler";
import { getScopeFromContext, updateBaggageContextWithScopes } from "../../common/utils";

//   agentic.session    — one user session (multiple turns share this)
//   agentic.turn       — one user message → one runner.runAsync call
//   agentic.invocation — one BaseAgent.runAsync activation
const SCOPE_AGENTIC_SESSION = "agentic.session";
const SCOPE_AGENTIC_TURN = "agentic.turn";
const SCOPE_AGENTIC_INVOCATION = "agentic.invocation";

function getAgentName(thisArg: any): string {
    return thisArg?.name || thisArg?.agent?.name || thisArg?.constructor?.name || "adk_agent";
}

export class ADKAgentSpanHandler extends DefaultSpanHandler {
    preTracing(_: WrapperArguments, currentContext: any, thisArg?: any): any {
        const self = getAgentName(thisArg);
        // The previous agent on the context is the *delegator*. If it differs
        // from us, we're a delegated sub-agent; stamp the from_agent /
        // from_agent_span_id keys so the AGENT schema accessors can emit
        // them as entity attributes. Read BEFORE we overwrite the active
        // agent name with our own below.
        const prevAgent = currentContext.getValue(ADK_AGENT_NAME_KEY) as string | undefined;
        if (prevAgent && prevAgent !== self) {
            currentContext = currentContext.setValue(FROM_AGENT_KEY, prevAgent);
            const prevSpan: any = currentContext.getValue(MONOCLE_ACTIVE_SPAN_KEY);
            const prevSpanId = prevSpan?.spanContext?.()?.spanId;
            if (prevSpanId) {
                currentContext = currentContext.setValue(FROM_AGENT_SPAN_ID_KEY, prevSpanId);
            }
        }
        // Claim ourselves as the active agent for any descendants.
        currentContext = currentContext.setValue(ADK_AGENT_NAME_KEY, self);
        // Each agent invocation gets its own invocation id. Always overwrite
        // (a parent's invocation scope is for the parent; this child agent
        // run is a separate invocation).
        currentContext = updateBaggageContextWithScopes(currentContext, {
            [SCOPE_AGENTIC_INVOCATION]: null,  // null → auto-generate id
        });
        return currentContext;
    }
}

export class ADKToolSpanHandler extends DefaultSpanHandler {}

export class ADKRunnerSpanHandler extends DefaultSpanHandler {
    // Suppress duplicate agentic.turn spans. The outermost runner call (whether
    // it's runEphemeral, a direct runAsync, or AgentTool's internal runAsync)
    // creates the turn span and stamps ADK_TURN_SPAN_ACTIVE_KEY on the context;
    // any nested runner wrapper sees the key and bails out before opening its
    // own span. The original method still runs normally — only span creation
    // is skipped.
    skipSpan(): boolean {
        return context.active().getValue(ADK_TURN_SPAN_ACTIVE_KEY) === true;
    }

    preTracing(_: WrapperArguments, currentContext: any, _thisArg?: any, callArgs?: any): any {
        // ADK_AGENT_NAME_KEY is intentionally NOT set here. That key tracks
        // the most-recently-active *agent invocation*, owned exclusively by
        // ADKAgentSpanHandler. If the runner also wrote to it, the first
        // agent.run wrapper underneath would mistake the runner's stamp for
        // a delegator and emit a spurious from_agent on the root agent.
        //
        // Mark the turn-span slot occupied so nested runner wrappers skip
        // their span creation. Set on the returned context so it propagates
        // through OTel's context.with frames into the inner generator.
        currentContext = currentContext.setValue(ADK_TURN_SPAN_ACTIVE_KEY, true);

        const params = callArgs?.[0] || {};
        const scopes: Record<string, string | null> = {};

        // Session: prefer the runner's sessionId param. If missing (e.g.
        // runEphemeral) and no session is already on the context, generate
        // one. Don't overwrite an inherited session — multi-turn workflows
        // need it stable across calls.
        if (!getScopeFromContext(currentContext, SCOPE_AGENTIC_SESSION)) {
            scopes[SCOPE_AGENTIC_SESSION] = params.sessionId ?? null;
        }
        // Turn: one user message → one turn. ADK's runEphemeral internally
        // calls runAsync; both go through this handler and must share a
        // single turn id. Only generate when nothing's already on the
        // context (i.e. the outermost runner call wins).
        if (!getScopeFromContext(currentContext, SCOPE_AGENTIC_TURN)) {
            scopes[SCOPE_AGENTIC_TURN] = null;
        }

        currentContext = updateBaggageContextWithScopes(currentContext, scopes);
        return currentContext;
    }
}

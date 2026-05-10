import { ADK_AGENT_NAME_KEY, WrapperArguments } from "../../common/constants";
import { DefaultSpanHandler } from "../../common/spanHandler";
import { getScopeFromContext, updateBaggageContextWithScopes } from "../../common/utils";

// Scope names match Python monocle's contract so traces stay interoperable.
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
        currentContext = currentContext.setValue(ADK_AGENT_NAME_KEY, getAgentName(thisArg));
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
    preTracing(_: WrapperArguments, currentContext: any, thisArg?: any, callArgs?: any): any {
        const rootAgentName = thisArg?.agent?.name || thisArg?.appName || "adk_runner";
        currentContext = currentContext.setValue(ADK_AGENT_NAME_KEY, rootAgentName);

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

import { context } from "@opentelemetry/api";
import { Span } from "../../common/opentelemetryUtils";
import {
    SCOPE_AGENTIC_SESSION,
    SCOPE_AGENTIC_TURN,
    WrapperArguments,
} from "../../common/constants";
import { DefaultSpanHandler } from "../../common/spanHandler";
import { getScopeFromContext, updateBaggageContextWithScopes } from "../../common/utils";
import { attachRunnerHooks, endRun } from "./agentsHookBridge";

// Turn span for Runner.run, plus the wiring of the Runner's lifecycle events to
// the hook bridge.
export class OpenAIAgentsSpanHandler extends DefaultSpanHandler {
    // An app-opened agentic.turn scope means the app is grouping several
    // Runner.run calls into one turn, so skip the per-run turn span. Inert
    // without the scope; the agent activations underneath still trace.
    skipSpan(params: { instance: any; args: IArguments; element: WrapperArguments }): boolean {
        if (getScopeFromContext(context.active(), SCOPE_AGENTIC_TURN)) {
            return true;
        }
        return super.skipSpan(params);
    }

    preTracing(
        element: WrapperArguments,
        currentContext: any,
        thisArg?: any,
        callArgs?: any,
    ): any {
        // The Runner is itself the RunHooks emitter.
        attachRunnerHooks(thisArg, element, element.tracer);

        const scopes: Record<string, string | null> = {};

        // Read from the caller's options, never fabricated. An inherited
        // session is left alone so it stays stable across turns.
        if (!getScopeFromContext(currentContext, SCOPE_AGENTIC_SESSION)) {
            const options = callArgs?.[2];
            const sessionId = options?.session?.sessionId ?? options?.conversationId;
            if (typeof sessionId === "string" && sessionId) {
                scopes[SCOPE_AGENTIC_SESSION] = sessionId;
            }
        }

        // One Runner.run = one turn. null → auto-generate the id.
        if (!getScopeFromContext(currentContext, SCOPE_AGENTIC_TURN)) {
            scopes[SCOPE_AGENTIC_TURN] = null;
        }

        return updateBaggageContextWithScopes(currentContext, scopes);
    }

    // Runner.run({ stream: true }) resolves at stream setup, kicking the agent
    // loop off without awaiting it, so ending the span there would record no
    // output and export the turn before the spans nested inside it exist.
    // StreamedRunResult.completed settles when the loop finishes; resolving to
    // the result itself keeps finalOutput readable by the output processor.
    resolveCompletion({ returnValue }: { returnValue: any }): Promise<any> | null {
        const completed = returnValue?.completed;
        if (completed && typeof completed.then === "function") {
            return Promise.resolve(completed).then(() => returnValue);
        }
        return null;
    }

    postProcessSpan(params: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
        exception?: any;
        currentContext?: any;
    }) {
        // An exception mid-run means agent_end / agent_tool_end never fire.
        endRun(params.span);
        super.postProcessSpan(params);
    }
}

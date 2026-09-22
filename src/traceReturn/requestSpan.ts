import { Attributes, Context, Span, SpanKind, SpanStatusCode, Tracer, context as contextApi, trace } from "@opentelemetry/api";
import { consoleLog } from "../common/logging";
import { ADD_NEW_WORKFLOW_SYMBOL} from "../instrumentation/common/constants";
import { Span as MonocleSpan } from "../instrumentation/common/opentelemetryUtils";
import { DefaultSpanHandler } from "../instrumentation/common/spanHandler";
import { getInstrumentor, updateBaggageContextWithScopes } from "../instrumentation/common/utils";
import { TRACE_RETURN_SCOPE_NAME } from "./constants";

// Opens the per-request root span that makes "one trace per request" true, and
// hands back the context the handler must run inside. Transport-agnostic: the
// Node req/res hook and a Web Request/Response façade both use this unchanged.

export interface TraceReturnRequest {
    span: Span;
    context: Context;
    traceId: string;
    end(outcome?: { error?: unknown; httpStatus?: number }): void;
}

export interface StartTraceReturnRequestOptions {
    name?: string;
    kind?: SpanKind;
    attributes?: Attributes;
}

export function startTraceReturnRequest(
    options: StartTraceReturnRequestOptions = {},
): TraceReturnRequest | null {
    const instrumentor = getInstrumentor();
    if (!instrumentor){
        // The preload never ran. Return null rather than throwing: a tracing
        // feature must not take the request down with it.
        consoleLog("[monocle] trace return: setupMonocle has not run; no request span");
        return null;
    }

    const tracer: Tracer = instrumentor.getTracer();

    // Scope first, and null for the value so it gets a generated id exactly as
    // setScopes() would. This is what marks every span in the request as
    // eligible for return, and the exporter's only filter.
    let ctx = updateBaggageContextWithScopes(contextApi.active(), {
        [TRACE_RETURN_SCOPE_NAME]: null,
    });

    // Keeps the tree shape. Once this span exists isRootSpan() is false for
    // everything inside, so wrapper.ts would stop injecting the `workflow` span.
    // This flag makes the first instrumented call insert one anyway, with the
    // framework-derived type this span cannot know. wrapper.ts:144 clears it.
    ctx = ctx.setValue(ADD_NEW_WORKFLOW_SYMBOL, true);

    const span = tracer.startSpan(
        options.name ?? "http.request",
        { kind: options.kind ?? SpanKind.SERVER, attributes: options.attributes },
        ctx,
    );

    // Inside ctx on purpose: setMonocleAttributes reads the scopes off the
    // ACTIVE context's baggage. Called outside, this span would miss
    // scope.monocle_trace_return and the exporter would drop the root of its
    // own trace.
    contextApi.with(ctx, () => {
        // startSpan() is typed as the API Span but always returns the SDK span,
        // which is what setMonocleAttributes reads (resource, spanContext).
        DefaultSpanHandler.setMonocleAttributes(span as MonocleSpan, null);
    });

    // Now make it the parent for the handler's work.
    ctx = trace.setSpan(ctx, span);

    let ended = false;
    return {
        span,
        context: ctx,
        traceId: span.spanContext().traceId,

        // Idempotent: res.end can fire more than once, and the trailer path must
        // not depend on the caller being careful. Must be called BEFORE popping —
        // SimpleSpanProcessor hands the span over synchronously on end, so this
        // span makes it into its own payload, which monocle_apptrace never does.
        end(outcome = {}) {
            if (ended) return;
            ended = true;
            const { error, httpStatus } = outcome;
            if (typeof httpStatus === "number") {
                span.setAttribute("http.status_code", httpStatus);
            }
            if (error) {
                span.recordException(error as any);
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: String((error as any)?.message ?? error),
                });
            } else if (typeof httpStatus === "number" && httpStatus >= 500) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${httpStatus}` });
            } else {
                span.setStatus({ code: SpanStatusCode.OK, message: "OK" });
            }
            span.end();
        },
    };
}

// Static imports: a lazy require() throws in the ESM build (see the same note
// in instrumentation.ts). Core modules are process singletons, so patching
// these prototypes reaches every server the app creates.
import * as http from "http";
import * as https from "https";
import type { IncomingMessage, ServerResponse } from "http";
import {
    Context, SpanKind, SpanStatusCode, context as contextApi, propagation, trace,
} from "@opentelemetry/api";
import { consoleLog } from "../../common/logging";
import { Span as MonocleSpan } from "../common/opentelemetryUtils";
import { DefaultSpanHandler } from "../common/spanHandler";
import { getInstrumentor, get_http_scopes, updateBaggageContextWithScopes } from "../common/utils";
import { MONOCLE_SCOPE_NAME_PREFIX } from "../common/constants";
import {
    WORKFLOW_TYPE_HOLDER_KEY, createWorkflowTypeHolder, resolveWorkflowType,
} from "../common/workflowTypeHolder";
import { HTTP_PROCESS } from "../metamodel/http/entities/httpProcess";
import { appendResponseChunk, getRoute, rememberOriginalUrl } from "./capture";
import { isPathExcluded } from "./excludePaths";

const HOOK_INSTALLED = Symbol.for("monocle2ai.httpServerHook");

export interface HttpRequestHooks {
    onRequestStart?(req: IncomingMessage, res: ServerResponse): void;
    scopesFor?(req: IncomingMessage): Record<string, string | null> | null;
    onBeforeEnd?(req: IncomingMessage, res: ServerResponse, traceId: string): Buffer | null;
}

// On globalThis, like TRACE_RETURN_EXPORTER_KEY in traceReturn/exporter.ts: the
// ESM and CJS builds have separate module state, so a module-level array can be
// pushed to by one copy while the copy that patched emit reads another.
const HOOKS_KEY = Symbol.for("monocle2ai.httpRequestHooks");

function registeredHooks(): HttpRequestHooks[] {
    const g = globalThis as any;
    if (!g[HOOKS_KEY]) g[HOOKS_KEY] = [];
    return g[HOOKS_KEY];
}

// Dependency inversion: trace return registers here rather than this module
// importing it, so the span path stays free of trace-return concerns and can be
// enabled independently later. Idempotent: registering twice would write the
// trailer twice into one response.
export function registerHttpRequestHooks(hooks: HttpRequestHooks): void {
    const all = registeredHooks();
    if (!all.includes(hooks)) all.push(hooks);
}

export function installHttpServerHook(): void {
    const g = globalThis as any;
    if (g[HOOK_INSTALLED]) return;
    g[HOOK_INSTALLED] = true;

    for (const mod of [http, https] as any[]) {
        const proto = mod?.Server?.prototype;
        if (!proto || typeof proto.emit !== "function") continue;
        patchEmit(proto);
    }
    consoleLog("[monocle] http server hook installed");
}

function patchEmit(proto: any): void {
    const originalEmit = proto.emit;
    proto.emit = function monocleHttpEmit(this: any, event: string, ...args: any[]) {
        if (event !== "request") return originalEmit.apply(this, [event, ...args]);
        const [req, res] = args as [IncomingMessage, ServerResponse];
        const passthrough = () => originalEmit.apply(this, [event, ...args]);

        // Excluded paths get zero hook involvement: no spans, no propagation
        // extraction, no response patches, no registered-hook callbacks. This is
        // the only lever for keeping a credential endpoint's body out of an
        // exporter, since bodies are captured unredacted.
        if (isPathExcluded(req?.url)) return passthrough();

        // Only startRequest is guarded. Wrapping the passthrough too would make a
        // handler that throws synchronously run a second time from the catch.
        let started: Context | null = null;
        try {
            started = startRequest(req, res);
        } catch (e) {
            // A tracing feature must never take a request down.
            console.warn(`[monocle] http hook failed, serving request untouched: ${e}`);
        }
        return started ? contextApi.with(started, passthrough) : passthrough();
    };
}

// Scopes configured with an http_header are imported here. get_http_scopes() has
// been populated by load_scopes() since it was written and read by nothing; this
// is its first consumer.
function importedScopes(req: IncomingMessage): Record<string, string> {
    const scopes: Record<string, string> = {};
    for (const [header, scopeName] of Object.entries(get_http_scopes())) {
        const value = req.headers[header];
        if (typeof value === "string") scopes[scopeName] = `${header}: ${value}`;
    }
    return scopes;
}

// One misbehaving registration must not take down the others or the span.
function safely<T>(what: string, fn: () => T): T | undefined {
    try {
        return fn();
    } catch (e) {
        console.warn(`[monocle] http hook: registered ${what} failed: ${e}`);
        return undefined;
    }
}

// Monocle scopes are server-side state, never client input. getScopesInternal()
// copies every monocle.scope.* baggage entry onto every span, so an extracted
// one would let a caller forge a scope - monocle_trace_return included, whose
// spans would then buffer unclaimed. traceparent continuation is untouched.
//
// Compared against the server's own baggage, snapshotted before extract:
// with no global propagator registered (the default) extract is a no-op, so
// everything it returns is ambient server state, and dropping it all would
// delete the application's own scopes from every span.
function stripImportedScopes(ambient: Context, ctx: Context): Context {
    const extracted = propagation.getBaggage(ctx);
    if (!extracted) return ctx;
    const own = (propagation.getBaggage(ambient)?.getAllEntries() ?? [])
        .filter(([key]) => key.startsWith(MONOCLE_SCOPE_NAME_PREFIX));
    const ownValues = new Map(own.map(([key, entry]) => [key, entry.value]));

    const forged = extracted.getAllEntries()
        .filter(([key, entry]) =>
            key.startsWith(MONOCLE_SCOPE_NAME_PREFIX) && ownValues.get(key) !== entry.value)
        .map(([key]) => key);

    let baggage = forged.length ? extracted.removeEntries(...forged) : extracted;
    // A baggage propagator replaces the whole baggage rather than merging, so
    // the server's own scopes are put back after the forged ones are dropped.
    for (const [key, entry] of own) if (!baggage.getEntry(key)) baggage = baggage.setEntry(key, entry);

    if (baggage === extracted) return ctx;
    if (forged.length) {
        consoleLog(`[monocle] http hook: dropped ${forged.length} scope(s) not set by this server`);
    }
    return propagation.setBaggage(ctx, baggage);
}

function startRequest(req: IncomingMessage, res: ServerResponse): Context | null {
    const instrumentor = getInstrumentor();
    if (!instrumentor) {
        consoleLog("[monocle] http hook: setupMonocle has not run; no request span");
        return null;
    }
    const tracer = instrumentor.getTracer();

    // Before any framework runs: Express rewrites req.url for a mounted router
    // or middleware, and the metamodel accessors read it at res.end.
    rememberOriginalUrl(req, typeof req.url === "string" ? req.url : "");

    // Whatever the globally registered propagator reads off the headers. With the
    // api default no-op propagator this is a no-op; an app that registers a real
    // one (e.g. via @opentelemetry/sdk-node) gets traceparent continuation here.
    const ambient = contextApi.active();
    let ctx = stripImportedScopes(ambient, propagation.extract(ambient, req.headers));

    const scopes = importedScopes(req);
    const hooks = registeredHooks();
    for (const hook of hooks) safely("onRequestStart", () => hook.onRequestStart?.(req, res));
    if (Object.keys(scopes).length) ctx = updateBaggageContextWithScopes(ctx, scopes);

    // Contributed by registered hooks so a scope like monocle_trace_return stays
    // gated by its own module rather than applied to every request here.
    for (const hook of hooks) {
        const extra = safely("scopesFor", () => hook.scopesFor?.(req));
        if (extra) ctx = updateBaggageContextWithScopes(ctx, extra);
    }

    const holder = createWorkflowTypeHolder();
    ctx = ctx.setValue(WORKFLOW_TYPE_HOLDER_KEY, holder);

    // The workflow span is the trace root and the http.process span its child.
    // That ordering is what puts the HTTP attributes at entity.1 rather than
    // entity.3, matching monocle_apptrace.
    const workflowSpan = tracer.startSpan("workflow", { kind: SpanKind.INTERNAL }, ctx);
    ctx = trace.setSpan(ctx, workflowSpan);

    // Best name available now. req.route is only set once the framework matches,
    // so finish() renames this to the template.
    const startName = spanName(req);
    const httpSpan = tracer.startSpan(startName, { kind: SpanKind.SERVER }, ctx);
    ctx = trace.setSpan(ctx, httpSpan);

    // Inside ctx: setMonocleAttributes reads scopes off the ACTIVE context's
    // baggage, so called outside it the spans would miss their scope attributes.
    contextApi.with(ctx, () => {
        DefaultSpanHandler.setMonocleAttributes(workflowSpan as MonocleSpan, null);
        DefaultSpanHandler.setMonocleAttributes(httpSpan as MonocleSpan, null);
    });

    installResponsePatches(req, res, {
        workflowSpan,
        httpSpan,
        holder,
        traceId: httpSpan.spanContext().traceId,
        startName,
    });
    return ctx;
}

function spanName(req: IncomingMessage): string {
    return `${req.method ?? ""} ${getRoute(req)}`.trim();
}

interface RequestState {
    workflowSpan: any;
    httpSpan: any;
    holder: ReturnType<typeof createWorkflowTypeHolder>;
    traceId: string;
    startName: string;
}

function finish(req: IncomingMessage, res: ServerResponse, state: RequestState, aborted: boolean): void {
    const { workflowSpan, httpSpan, holder } = state;

    // Routing has run by now, so getRoute resolves the template: GET /users/:id
    // rather than the GET /users/12345 we could only guess at request start.
    try {
        const resolved = spanName(req);
        if (resolved && resolved !== state.startName) httpSpan.updateName(resolved);
    } catch (e) {
        consoleLog(`[monocle] http hook: could not rename the span: ${e}`);
    }

    try {
        new DefaultSpanHandler().processSpan({
            span: httpSpan,
            instance: req,
            args: [req] as any,
            returnValue: res,
            outputProcessor: [HTTP_PROCESS],
            wrappedPackage: "node:http",
        });
    } catch (e) {
        consoleLog(`[monocle] http hook: could not apply the metamodel: ${e}`);
    }

    // Its own try: a throw here must not skip httpSpan.end() below, which would
    // otherwise leave it open the same way an unguarded abort path would.
    try {
        if (aborted) {
            httpSpan.setStatus({ code: SpanStatusCode.ERROR, message: "client disconnected" });
        } else if (res.statusCode >= 500) {
            httpSpan.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.statusCode}` });
        } else {
            httpSpan.setStatus({ code: SpanStatusCode.OK, message: "OK" });
        }
    } catch (e) {
        consoleLog(`[monocle] http hook: could not set the http span status: ${e}`);
    }
    try {
        httpSpan.end();
    } catch (e) {
        consoleLog(`[monocle] http hook: could not end the http span: ${e}`);
    }

    // Guarded separately from the http span above: a throw here would otherwise
    // leak the workflow span AND skip the trailer the response header promises.
    try {
        // The workflow span's type is only knowable now, after the framework has run.
        // setWorkflowAttributes fills entity.1.name and a generic entity.1.type off the
        // context; the holder then supplies the framework-specific type it could not know.
        DefaultSpanHandler.setWorkflowAttributes({ span: workflowSpan });
        DefaultSpanHandler.setAppHostingIdentifierAttribute(workflowSpan);
        workflowSpan.setAttribute("entity.1.type", resolveWorkflowType(holder));
        workflowSpan.setStatus({ code: SpanStatusCode.OK, message: "OK" });
    } catch (e) {
        consoleLog(`[monocle] http hook: could not finalise the workflow span: ${e}`);
    }
    try {
        workflowSpan.end();
    } catch (e) {
        consoleLog(`[monocle] http hook: could not end the workflow span: ${e}`);
    }
}

function installResponsePatches(req: IncomingMessage, res: ServerResponse, state: RequestState): void {
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    let finished = false;

    // Pass-through, not buffering: the body streams to the client as normal.
    res.write = function (this: ServerResponse, ...args: any[]) {
        appendResponseChunk(res, args[0]);
        return (origWrite as any)(...args);
    } as any;

    res.end = function (this: ServerResponse, chunk?: any, encoding?: any, callback?: any) {
        // end(cb) / end(chunk, cb) / end(chunk, encoding, cb)
        if (typeof chunk === "function") { callback = chunk; chunk = undefined; encoding = undefined; }
        else if (typeof encoding === "function") { callback = encoding; encoding = undefined; }

        if (finished) return (origEnd as any)(chunk, encoding, callback);

        // Capture only: the chunk itself is still handed to origEnd below so
        // Node keeps computing the implicit Content-Length. Separate from the
        // finish() try: a throw here must not skip finish(), or finished would
        // flip true while the spans stay open.
        try {
            appendResponseChunk(res, chunk);
        } catch (e) {
            console.warn(`[monocle] http hook: response chunk capture failed: ${e}`);
        }

        try {
            // Spans end BEFORE any registered hook runs: SimpleSpanProcessor hands
            // them over synchronously, so a trailer built here contains them.
            finish(req, res, state, false);
        } catch (e) {
            console.warn(`[monocle] http hook: response finalisation failed: ${e}`);
        } finally {
            // Flipped only after finish() was attempted, so the close handler
            // below (sharing this guard) is never blocked from cleaning up
            // spans that finish() didn't get to.
            finished = true;
        }

        // Collected before anything is written: a failure ending the spans must
        // not cancel a trailer the response header has already promised, nor
        // one hook cancel another.
        const trailers: Buffer[] = [];
        for (const hook of registeredHooks()) {
            const extra = safely("onBeforeEnd", () => hook.onBeforeEnd?.(req, res, state.traceId));
            if (extra) trailers.push(extra);
        }

        // The common case, and the only case with trace return off: the whole
        // body reaches end(), which is the only way Node computes an implicit
        // Content-Length. Splitting it into write()+end() would silently
        // re-frame every response in the application as chunked.
        if (!trailers.length) return (origEnd as any)(chunk, encoding, callback);

        // Trailer bytes must follow the body, so here the split is required -
        // and content-length was dropped when the trailer was promised.
        if (chunk !== undefined && chunk !== null) {
            safely("body write", () => (origWrite as any)(chunk, encoding));
        }
        for (const trailer of trailers) safely("trailer write", () => (origWrite as any)(trailer));
        return (origEnd as any)(callback);
    } as any;

    // res.end may never fire: client disconnect, a handler that forgets to
    // respond, res.destroy()/res.socket.destroy(), or a requestTimeout/
    // headersTimeout. Its own try: res.write/res.end are already patched
    // above, so a res without .on must not leave that state unlogged.
    try {
        res.on("close", () => {
            if (finished) return;
            finished = true;
            try {
                finish(req, res, state, true);
            } catch (e) {
                console.warn(`[monocle] http hook: abort finalisation failed: ${e}`);
            }
        });
    } catch (e) {
        console.warn(`[monocle] http hook: could not register the close backstop: ${e}`);
    }
}

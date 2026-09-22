import { timingSafeEqual } from "crypto";
import { consoleLog } from "../common/logging";

import {
    MONOCLE_TRACE_RETURN_ENABLED_ENV,
    MONOCLE_TRACE_RETRIEVAL_CALLBACK_ENV,
    MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY_ENV,
    TRACE_RETURN_REQUEST_HEADER,
} from "./constants";

/**
 * Two layer gate, mirroring monocle_apptrace's trace_return.py: a process wide master switch, plus a per-request auth callback. every failure path denies - a misconfigured callback must never allow.
 */

// Structural rather than the global DOM/undici Headers type, so this compiles
// the same whether or not lib.dom is in scope. Covers Web Headers, Node's
// lowercased req.headers object, and a plain dict.
interface HeaderGetter {
    get(name: string): string | null | undefined;
}

export type TraceReturnHeaders = HeaderGetter | Record<string, string | string[] | undefined>;
export type TraceRetrievalCallback = (headers: TraceReturnHeaders) => boolean;

// Read live rather than latched: tests and `.env.monocle` both mutate this, and
// the check is trivial. Note step 6 latches the *exporter* at setup regardless,
// because NodeTracerProvider fixes its span processors at construction.
export function isTraceReturnEnabled(): boolean {
    return (process.env[MONOCLE_TRACE_RETURN_ENABLED_ENV] ?? "false").toLowerCase() === "true";
}

export function getHeaderCaseInsensitive(headers: TraceReturnHeaders, name: string): string | undefined {
    if(!headers) return undefined;

    const getter = (headers as HeaderGetter).get;

    if(typeof getter === "function") {
        return getter.call(headers, name) ?? undefined;
    }

    const lowerName = name.toLowerCase();

    for (const [key, value] of Object.entries(
        headers as Record<string, string | string[] | undefined>,
    )) {
        if (key.toLowerCase() !== lowerName) continue;
        // Node lowercases header names but turns repeats into an array. A
        // repeated credential is ambiguous, so treat anything but a single
        // value as absent rather than guessing which copy was meant.
        if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
        return value;
    }
    return undefined;
}

function constantTimeEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");

    // timingSafeEqual throws on a length mismatch, so it has to be short-circuited.
    // That leaks the key length — exactly as hmac.compare_digest documents for
    // str inputs, so this is parity, not a new weakness.
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

export function defaultTraceRetrievalCallback(headers: TraceReturnHeaders): boolean {
    const key = process.env[MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY_ENV];
    if (!key) return false;
    const value = getHeaderCaseInsensitive(headers, TRACE_RETURN_REQUEST_HEADER);
    if (value === undefined) return false;
    return constantTimeEquals(value, key);
}

type CallbackState =
    | { kind: "default" }
    | { kind: "ready"; callback: TraceRetrievalCallback }
    | { kind: "failed" };

// null = init has not run. See currentCallback() for why that is not fatal.
let callbackState: CallbackState | null = null;

// The one real divergence from monocle_apptrace, whose _resolve_callback runs
// per request through synchronous importlib. Node's import() is async while
// the gate must answer synchronously, so it resolves once, here. modulePath is
// absolute or a bare specifier — a relative path resolves against this file.
export async function initTraceRetrievalCallback(): Promise<void> {
    const spec = process.env[MONOCLE_TRACE_RETRIEVAL_CALLBACK_ENV];
    if (!spec) {
        callbackState = { kind: "default" };
        return;
    }
    // Deny for the duration of the await, and permanently if anything below fails.
    callbackState = { kind: "failed" };

    // lastIndexOf, where monocle_apptrace uses partition(":") — Node specifiers
    // legitimately contain colons (file:// URLs, drive letters) and the export
    // name never does.
    const sep = spec.lastIndexOf(":");
    if (sep <= 0 || sep === spec.length - 1) {
        console.warn(
            `[monocle] invalid ${MONOCLE_TRACE_RETRIEVAL_CALLBACK_ENV} (expected "module:export"): ${spec}`,
        );
        return;
    }
    const modulePath = spec.slice(0, sep);
    const exportName = spec.slice(sep + 1);

    try {
        const mod: any = await import(modulePath);
        // default?.[name] covers a CJS module whose exports land under default.
        const candidate = mod?.[exportName] ?? mod?.default?.[exportName];
        if (typeof candidate !== "function") {
            console.warn(`[monocle] trace-retrieval callback "${spec}" is not a function`);
            return;
        }
        callbackState = { kind: "ready", callback: candidate };
        consoleLog(`[monocle] trace-retrieval callback resolved: ${spec}`);
    } catch (e) {
        // Broad by design, as upstream: any resolve failure denies rather than
        // propagating into the request path.
        console.warn(`[monocle] could not load trace-retrieval callback "${spec}": ${e}`);
    }
}


export function resetTraceRetrievalCallbackForTests(): void {
    callbackState = null;
}

function currentCallback(): TraceRetrievalCallback | null {
    if (callbackState === null) {
        // Init never ran. With no custom callback configured there was nothing to
        // resolve, so the default key check still works and the zero-config path
        // needs no setup at all.
        if (!process.env[MONOCLE_TRACE_RETRIEVAL_CALLBACK_ENV]) return defaultTraceRetrievalCallback;
        // A custom callback IS configured but was never resolved, or is still
        // resolving. We cannot await here, so deny.
        return null;
    }
    if (callbackState.kind === "default") return defaultTraceRetrievalCallback;
    if (callbackState.kind === "ready") return callbackState.callback;
    return null;
}

export function isTraceReturnAuthorized(headers: TraceReturnHeaders): boolean {
    const callback = currentCallback();
    if (!callback) {
        consoleLog("[monocle] trace retrieval denied: no usable authorization callback");
        return false;
    }
    try {
        const result: any = callback(headers);
        // A JS-specific hazard with no counterpart upstream: an async callback
        // returns a Promise, and every Promise is truthy. Boolean(result) would
        // silently authorize every request.
        if (result && typeof result.then === "function") {
            console.warn(
                "[monocle] trace-retrieval callback returned a Promise; the gate is synchronous. Denying.",
            );
            return false;
        }
        return Boolean(result);
    } catch (e) {
        console.warn(`[monocle] trace-retrieval authorization callback raised: ${e}`);
        return false;
    }
}

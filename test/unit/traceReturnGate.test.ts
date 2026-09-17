import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "url";
import {
    isTraceReturnEnabled,
    getHeaderCaseInsensitive,
    defaultTraceRetrievalCallback,
    isTraceReturnAuthorized,
    initTraceRetrievalCallback,
    resetTraceRetrievalCallbackForTests,
} from "../../src/traceReturn/gate";

const FIX = fileURLToPath(new URL("../fixtures/traceRetrievalCallback.mjs", import.meta.url));
const H = "x-monocle-retrieve-traces";
let warn: any;

beforeEach(() => {
    resetTraceRetrievalCallbackForTests();
    delete process.env.MONOCLE_ENABLE_TRACE_RETURN;
    delete process.env.MONOCLE_TRACE_RETRIEVAL_CALLBACK;
    delete process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("master switch", () => {
    it("is off unless explicitly true", () => {
        expect(isTraceReturnEnabled()).toBe(false);
        process.env.MONOCLE_ENABLE_TRACE_RETURN = "TRUE";
        expect(isTraceReturnEnabled()).toBe(true);
        process.env.MONOCLE_ENABLE_TRACE_RETURN = "1";
        expect(isTraceReturnEnabled()).toBe(false);
    });
});

describe("header lookup", () => {
    it("is case-insensitive over a plain object", () => {
        expect(getHeaderCaseInsensitive({ "X-Monocle-Retrieve-Traces": "k" }, H)).toBe("k");
    });

    it("works with a Web Headers object", () => {
        expect(getHeaderCaseInsensitive(new Headers({ [H]: "k" }), H)).toBe("k");
    });

    it("unwraps a single-value array but treats a repeated credential as absent", () => {
        expect(getHeaderCaseInsensitive({ [H]: ["k"] }, H)).toBe("k");
        expect(getHeaderCaseInsensitive({ [H]: ["k", "k2"] }, H)).toBeUndefined();
    });

    it("returns undefined when the header is missing", () => {
        expect(getHeaderCaseInsensitive({}, H)).toBeUndefined();
    });
});

describe("default key check", () => {
    it("denies when the server has no key configured", () => {
        expect(defaultTraceRetrievalCallback({ [H]: "k" })).toBe(false);
    });

    it("accepts the matching key and rejects everything else", () => {
        process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY = "secret";
        expect(defaultTraceRetrievalCallback({ [H]: "secret" })).toBe(true);
        expect(defaultTraceRetrievalCallback({ [H]: "wrong!" })).toBe(false);
        expect(defaultTraceRetrievalCallback({})).toBe(false);
    });

    // timingSafeEqual throws on unequal lengths; this must deny, not crash.
    it("rejects a shorter key without throwing", () => {
        process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY = "secret";
        expect(defaultTraceRetrievalCallback({ [H]: "s" })).toBe(false);
    });
});

describe("authorization", () => {
    it("works with no init at all when no custom callback is configured", () => {
        process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY = "secret";
        expect(isTraceReturnAuthorized({ [H]: "secret" })).toBe(true);
    });

    // The fail-closed window: a custom callback is configured but setup never
    // resolved it. Must not silently fall back to the default key.
    it("denies when a callback is configured but never initialised", () => {
        process.env.MONOCLE_TRACE_RETRIEVAL_CALLBACK = `${FIX}:allowAll`;
        process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY = "secret";
        expect(isTraceReturnAuthorized({ [H]: "secret" })).toBe(false);
    });

    it("uses a resolved custom callback", async () => {
        process.env.MONOCLE_TRACE_RETRIEVAL_CALLBACK = `${FIX}:allowAll`;
        await initTraceRetrievalCallback();
        expect(isTraceReturnAuthorized({})).toBe(true);
    });

    it("lets a custom callback override a valid default key", async () => {
        process.env.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY = "secret";
        process.env.MONOCLE_TRACE_RETRIEVAL_CALLBACK = `${FIX}:denyAll`;
        await initTraceRetrievalCallback();
        expect(isTraceReturnAuthorized({ [H]: "secret" })).toBe(false);
    });
});

describe("every failure path denies", () => {
    it.each([
        ["a throwing callback", `${FIX}:boom`],
        ["a non-function export", `${FIX}:notAFunction`],
        ["a module that does not exist", "/nope/missing.mjs:allowAll"],
        ["a spec with no separator", "noseparator"],
    ])("denies on %s", async (_label, spec) => {
        process.env.MONOCLE_TRACE_RETRIEVAL_CALLBACK = spec;
        await initTraceRetrievalCallback();
        expect(isTraceReturnAuthorized({})).toBe(false);
        expect(warn).toHaveBeenCalled();
    });

    // No Python counterpart: every Promise is truthy, so Boolean(result) on an
    // async callback would authorize unconditionally.
    it("denies an async callback instead of trusting its Promise", async () => {
        process.env.MONOCLE_TRACE_RETRIEVAL_CALLBACK = `${FIX}:asyncCheck`;
        await initTraceRetrievalCallback();
        expect(isTraceReturnAuthorized({})).toBe(false);
    });
});

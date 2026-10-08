import { describe, it, expect, afterEach } from "vitest";
import { isPathExcluded, resetExcludedPathsForTests } from "../../src/instrumentation/http/excludePaths";
import { getInstrumentor, setInstrumentor } from "../../src/instrumentation/common/utils";

function withEnv(value: string | undefined, fn: () => void) {
    const previous = process.env.MONOCLE_HTTP_EXCLUDE_PATHS;
    if (value === undefined) delete process.env.MONOCLE_HTTP_EXCLUDE_PATHS;
    else process.env.MONOCLE_HTTP_EXCLUDE_PATHS = value;
    resetExcludedPathsForTests();
    try { fn(); } finally {
        if (previous === undefined) delete process.env.MONOCLE_HTTP_EXCLUDE_PATHS;
        else process.env.MONOCLE_HTTP_EXCLUDE_PATHS = previous;
        resetExcludedPathsForTests();
    }
}

function withMastra(fn: () => void) {
    const previous = getInstrumentor();
    setInstrumentor({ hookedPackages: new Set(["@mastra/core"]) });
    resetExcludedPathsForTests();
    try { fn(); } finally {
        setInstrumentor(previous);
        resetExcludedPathsForTests();
    }
}

afterEach(() => resetExcludedPathsForTests());

describe("exclude defaults — applied with no configuration", () => {
    it("excludes framework build output and browser incidentals", () => {
        withEnv(undefined, () => {
            expect(isPathExcluded("/_next/static/chunks/main.js")).toBe(true);
            expect(isPathExcluded("/favicon.ico")).toBe(true);
            expect(isPathExcluded("/__nextjs_source-map")).toBe(true);
            expect(isPathExcluded("/.well-known/appspecific/com.chrome.devtools.json")).toBe(true);
            expect(isPathExcluded("/assets/main-v7G9bA48.js")).toBe(true);
        });
    });

    it("leaves real application traffic alone", () => {
        withEnv(undefined, () => {
            expect(isPathExcluded("/api/travel")).toBe(false);
            expect(isPathExcluded("/")).toBe(false);
        });
    });
});

describe("exclude defaults — the user list merges rather than replaces", () => {
    it("honours the user's entries and the defaults together", () => {
        withEnv("/login", () => {
            expect(isPathExcluded("/login")).toBe(true);
            expect(isPathExcluded("/favicon.ico")).toBe(true);
        });
    });

    it("accepts the $ and * grammar from the environment too", () => {
        withEnv("/api/orders$,/api/users/*/avatar$", () => {
            expect(isPathExcluded("/api/orders")).toBe(true);
            expect(isPathExcluded("/api/orders/42")).toBe(false);
            expect(isPathExcluded("/api/users/7/avatar")).toBe(true);
            expect(isPathExcluded("/api/users/7/profile")).toBe(false);
        });
    });
});

// Before defaults existed, an unresolvable request target was excluded only
// because a non-empty list implied the user was protecting something. Defaults
// are always non-empty, so that rule has to stay tied to the user's list or
// every app would silently stop tracing malformed targets.
describe("exclude defaults — an unresolvable target still turns on the user's list", () => {
    it("traces an unresolvable target when only the defaults are active", () => {
        withEnv(undefined, () => expect(isPathExcluded("http://[::1")).toBe(false));
    });

    it("excludes an unresolvable target once the user configures a list", () => {
        withEnv("/login", () => expect(isPathExcluded("http://[::1")).toBe(true));
    });
});

describe("exclude defaults — Mastra tier is gated on Mastra being loaded", () => {
    it("does not touch /api/agents in an app that is not running Mastra", () => {
        withEnv(undefined, () => {
            expect(isPathExcluded("/api/agents")).toBe(false);
            expect(isPathExcluded("/api/tools")).toBe(false);
        });
    });

    it("excludes the playground API once Mastra is loaded", () => {
        withMastra(() => {
            expect(isPathExcluded("/api/agents", "GET")).toBe(true);
            expect(isPathExcluded("/api/agents/weather-agent", "GET")).toBe(true);
            expect(isPathExcluded("/api/agents/weather-agent/voice/speakers", "GET")).toBe(true);
            expect(isPathExcluded("/api/memory/threads", "GET")).toBe(true);
            expect(isPathExcluded("/api/editor/builder/settings", "GET")).toBe(true);
            // A route the sampled corpus never contained: the GET rule covers
            // it anyway, which enumerating paths did not.
            expect(isPathExcluded("/api/workspaces", "GET")).toBe(true);
            expect(isPathExcluded("/api/channels/platforms", "GET")).toBe(true);
            // Dev endpoints stay method-blind.
            expect(isPathExcluded("/__refresh")).toBe(true);
        });
    });

    it("leaves a POST to the playground API traced, since that is real work", () => {
        withMastra(() => {
            expect(isPathExcluded("/api/agents/weather-agent/send-message", "POST")).toBe(false);
            expect(isPathExcluded("/api/workflows/my-flow/start", "POST")).toBe(false);
        });
    });

    // The whole point of the * and $ grammar: this is the only real span in
    // the 48-file Mastra trace set.
    it("keeps the one route that carries real agent work", () => {
        withMastra(() => {
            expect(isPathExcluded("/api/agents/weather-agent/send-message")).toBe(false);
        });
    });
});

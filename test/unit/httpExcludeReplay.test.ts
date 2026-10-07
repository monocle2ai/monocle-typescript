import { describe, it, expect, afterEach } from "vitest";
import { isPathExcluded, resetExcludedPathsForTests } from "../../src/instrumentation/http/excludePaths";
import { getInstrumentor, setInstrumentor } from "../../src/instrumentation/common/utils";

// Every string below is a real entity.1.route, lifted verbatim from trace
// files two demo apps wrote. This is a regression test against production
// data rather than inputs someone imagined, which is what makes it worth
// having: the defaults were derived from these corpora, so a change that
// quietly stops covering one of them fails here.

const MASTRA_PLAYGROUND = [
    "/api/editor/builder/settings",
    "/api/editor/builder/models/available",
    "/api/system/packages",
    "/api/agents",
    "/api/agents/providers",
    "/api/agents/weather-agent",
    "/api/agents/weather-agent/voice/speakers",
    "/api/agents/weather-agent/send-message",
    "/api/memory/threads",
    "/api/memory/threads/136f975f-0041-4f6c-aff4-942a03e2e763",
    "/api/memory/threads/136f975f-0041-4f6c-aff4-942a03e2e763/messages",
    "/api/memory/threads/136f975f-0041-4f6c-aff4-942a03e2e763/working-memory",
    "/api/memory/status",
    "/api/memory/config",
    "/api/mcp/v0/servers",
    "/api/workflows",
    "/api/tools",
    "/api/scores/scorers",
    "/api/processors",
    "/api/auth/capabilities",
    "/assets/style-jfo8f4wv.css",
    "/assets/preload-helper-PPVm8Dsz.js",
    "/assets/main-v7G9bA48.js",
    "/assets/index-oV0vDRdi.js",
    "/assets/MonaSans-VariableFont_wdth-wght-CX-7s9jm.ttf",
    "/assets/CommitMono-400-Regular-DzkyLZ26.woff2",
    "/__restart-active-workflow-runs",
    "/__refresh",
    "/",
];

const NEXT_TRAVEL_APP = [
    "/api/travel",
    "/.well-known/appspecific/com.chrome.devtools.json",
    "/__nextjs_source-map",
    "/favicon.ico",
    "/_next/static/chunks/src_app_globals_162hn9o.css",
    "/_next/static/chunks/src_app_globals_162hn9o.css.map",
    "/_next/static/chunks/turbopack-_08bm286._.js",
    "/_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_164kp-6._.js",
    "/_next/static/chunks/node_modules_next_dist_compiled_react-dom_096_9a-._.js",
    "/_next/static/chunks/node_modules_next_dist_compiled_next-devtools_index_090k2jm.js",
    "/_next/static/chunks/node_modules_%40swc_helpers_cjs_1r9vbqw._.js",
    "/_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js",
    "/_next/static/chunks/3r6jr3c-wi8gk.css",
    "/_next/static/chunks/2eotlnmoavcd9.js",
    "/",
];

function survivors(routes: string[]): string[] {
    return routes.filter((route) => !isPathExcluded(route));
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

function withoutMastra(fn: () => void) {
    const previous = getInstrumentor();
    setInstrumentor({ hookedPackages: new Set<string>() });
    resetExcludedPathsForTests();
    try { fn(); } finally {
        setInstrumentor(previous);
        resetExcludedPathsForTests();
    }
}

afterEach(() => resetExcludedPathsForTests());

describe("exclude replay — Mastra playground corpus", () => {
    it("keeps only the agent call and the root page", () => {
        withMastra(() => {
            expect(survivors(MASTRA_PLAYGROUND)).toEqual([
                "/api/agents/weather-agent/send-message",
                "/",
            ]);
        });
    });

    it("keeps the whole corpus when Mastra is not loaded, bar the universal noise", () => {
        withoutMastra(() => {
            const kept = survivors(MASTRA_PLAYGROUND);
            expect(kept).toContain("/api/agents");
            expect(kept).toContain("/api/agents/weather-agent/send-message");
            // /assets/ is universal, so it goes regardless of framework.
            expect(kept).not.toContain("/assets/main-v7G9bA48.js");
        });
    });
});

describe("exclude replay — Next.js travel app corpus", () => {
    it("keeps only the API route and the root page", () => {
        withoutMastra(() => {
            expect(survivors(NEXT_TRAVEL_APP)).toEqual(["/api/travel", "/"]);
        });
    });

    it("excludes percent-encoded chunk names, which only match once decoded", () => {
        withoutMastra(() => {
            expect(isPathExcluded("/_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client.js")).toBe(true);
        });
    });
});

import { describe, it, expect, afterEach } from "vitest";
import { isPathExcluded, resetExcludedPathsForTests } from "../../src/instrumentation/http/excludePaths";
import { getInstrumentor, setInstrumentor } from "../../src/instrumentation/common/utils";

// Every string below is a real entity.1.route, lifted verbatim from trace
// files two demo apps wrote. This is a regression test against production
// data rather than inputs someone imagined, which is what makes it worth
// having: the defaults were derived from these corpora, so a change that
// quietly stops covering one of them fails here.

const MASTRA_PLAYGROUND: [string, string][] = [
    ["GET", "/"],
    ["GET", "/api/agents"],
    ["GET", "/api/agents/providers"],
    ["GET", "/api/agents/weather-agent"],
    ["GET", "/api/agents/weather-agent/voice/speakers"],
    ["GET", "/api/auth/capabilities"],
    ["GET", "/api/channels/platforms"],
    ["GET", "/api/editor/builder/settings"],
    ["GET", "/api/editor/builder/models/available"],
    ["GET", "/api/mcp/v0/servers"],
    ["GET", "/api/memory/config"],
    ["GET", "/api/memory/status"],
    ["GET", "/api/memory/threads"],
    ["GET", "/api/memory/threads/136f975f-0041-4f6c-aff4-942a03e2e763"],
    ["GET", "/api/memory/threads/136f975f-0041-4f6c-aff4-942a03e2e763/messages"],
    ["GET", "/api/memory/threads/136f975f-0041-4f6c-aff4-942a03e2e763/working-memory"],
    ["GET", "/api/processors"],
    ["GET", "/api/scores/scorers"],
    ["GET", "/api/system/packages"],
    ["GET", "/api/tools"],
    ["GET", "/api/workflows"],
    ["GET", "/api/workspaces"],
    ["GET", "/assets/style-jfo8f4wv.css"],
    ["GET", "/assets/main-v7G9bA48.js"],
    ["GET", "/assets/CommitMono-400-Regular-DzkyLZ26.woff2"],
    ["GET", "/mastra-dark-tile.svg"],
    ["POST", "/__refresh"],
    ["POST", "/__restart-active-workflow-runs"],
    ["POST", "/api/agents/weather-agent/send-message"],
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

function survivingRequests(requests: [string, string][]): string[] {
    return requests.filter(([method, route]) => !isPathExcluded(route, method)).map(([, r]) => r);
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
    // One real span in the whole session. Everything else the playground
    // issues is a GET; the only non-GET noise is the two dev endpoints.
    it("keeps only the agent call", () => {
        withMastra(() => {
            expect(survivingRequests(MASTRA_PLAYGROUND)).toEqual([
                "/api/agents/weather-agent/send-message",
            ]);
        });
    });

    it("keeps the playground API when Mastra is not loaded, bar the universal noise", () => {
        withoutMastra(() => {
            const kept = survivingRequests(MASTRA_PLAYGROUND);
            expect(kept).toContain("/api/agents");
            expect(kept).toContain("/api/agents/weather-agent/send-message");
            expect(kept).not.toContain("/assets/main-v7G9bA48.js");
        });
    });

    // /api is denied wholesale; the keep-list is what brings the agent call
    // back. It is method-blind on purpose, since some Mastra execution routes
    // are GET (an agent-controller session stream, for one).
    it("keeps the execution route while excluding the listing above it", () => {
        withMastra(() => {
            expect(isPathExcluded("/api/agents/weather-agent/send-message", "POST")).toBe(false);
            expect(isPathExcluded("/api/agents/weather-agent/send-message", "GET")).toBe(false);
            expect(isPathExcluded("/api/agents", "GET")).toBe(true);
            expect(isPathExcluded("/api/agents/weather-agent", "GET")).toBe(true);
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

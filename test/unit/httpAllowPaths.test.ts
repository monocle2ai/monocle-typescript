import { describe, it, expect, afterEach } from "vitest";
import { isPathExcluded, resetExcludedPathsForTests } from "../../src/instrumentation/http/excludePaths";
import { getInstrumentor, setInstrumentor } from "../../src/instrumentation/common/utils";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const previous: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(vars)) {
        previous[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    resetExcludedPathsForTests();
    try { fn(); } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        resetExcludedPathsForTests();
    }
}

function withMastra(fn: () => void) {
    const previous = getInstrumentor();
    setInstrumentor({ hookedPackages: new Set(["@mastra/core"]) });
    try { fn(); } finally { setInstrumentor(previous); }
}

afterEach(() => resetExcludedPathsForTests());

// Precedence, strongest first:
//   1. MONOCLE_HTTP_ALLOW_PATHS    traced
//   2. MONOCLE_HTTP_EXCLUDE_PATHS  excluded
//   3. framework keep list         traced
//   4. built-in defaults           excluded
describe("allow paths — outranks every exclusion", () => {
    it("rescues a path the user also excluded", () => {
        withEnv({
            MONOCLE_HTTP_ALLOW_PATHS: "/api/orders/public$",
            MONOCLE_HTTP_EXCLUDE_PATHS: "/api/orders",
        }, () => {
            expect(isPathExcluded("/api/orders/public", "GET")).toBe(false);
            expect(isPathExcluded("/api/orders/secret", "GET")).toBe(true);
        });
    });

    it("rescues a path the built-in defaults exclude", () => {
        withEnv({ MONOCLE_HTTP_ALLOW_PATHS: "/assets/report.json$" }, () => {
            expect(isPathExcluded("/assets/report.json", "GET")).toBe(false);
            expect(isPathExcluded("/assets/main.js", "GET")).toBe(true);
        });
    });

    it("rescues a Mastra playground route from the /api deny", () => {
        withEnv({ MONOCLE_HTTP_ALLOW_PATHS: "/api/workspaces$" }, () => {
            withMastra(() => {
                expect(isPathExcluded("/api/workspaces", "GET")).toBe(false);
                expect(isPathExcluded("/api/agents", "GET")).toBe(true);
            });
        });
    });

    it("rescues the root page a Next.js app renders", () => {
        withEnv({ MONOCLE_HTTP_ALLOW_PATHS: "/$" }, () => {
            withMastra(() => expect(isPathExcluded("/", "GET")).toBe(false));
        });
    });
});

describe("allow paths — the shared grammar", () => {
    it("honours a method prefix", () => {
        withEnv({
            MONOCLE_HTTP_ALLOW_PATHS: "GET /internal/",
            MONOCLE_HTTP_EXCLUDE_PATHS: "/internal/",
        }, () => {
            expect(isPathExcluded("/internal/stats", "GET")).toBe(false);
            expect(isPathExcluded("/internal/stats", "POST")).toBe(true);
        });
    });

    it("honours $ and * just as the exclude list does", () => {
        withEnv({
            MONOCLE_HTTP_ALLOW_PATHS: "/api/users/*/avatar$",
            MONOCLE_HTTP_EXCLUDE_PATHS: "/api/users/",
        }, () => {
            expect(isPathExcluded("/api/users/7/avatar", "GET")).toBe(false);
            expect(isPathExcluded("/api/users/7/avatar/raw", "GET")).toBe(true);
            expect(isPathExcluded("/api/users/7/profile", "GET")).toBe(true);
        });
    });

    it("drops unusable entries rather than failing the whole list", () => {
        withEnv({
            MONOCLE_HTTP_ALLOW_PATHS: " , $ , /assets/keep.json$ ,, ",
        }, () => {
            expect(isPathExcluded("/assets/keep.json", "GET")).toBe(false);
            expect(isPathExcluded("/assets/other.json", "GET")).toBe(true);
        });
    });
});

describe("allow paths — absent or empty changes nothing", () => {
    it("leaves the defaults in force when unset", () => {
        withEnv({ MONOCLE_HTTP_ALLOW_PATHS: undefined }, () => {
            expect(isPathExcluded("/assets/main.js", "GET")).toBe(true);
            expect(isPathExcluded("/api/travel", "POST")).toBe(false);
        });
    });

    it("leaves the defaults in force when empty", () => {
        withEnv({ MONOCLE_HTTP_ALLOW_PATHS: "" }, () => {
            expect(isPathExcluded("/favicon.ico", "GET")).toBe(true);
        });
    });

    // The allow list matches patterns against a path. A target that could not
    // be resolved to one cannot be rescued, so the user's exclude list still
    // decides - ambiguity keeps favouring the secret.
    it("cannot rescue a request target that will not resolve to a path", () => {
        withEnv({
            MONOCLE_HTTP_ALLOW_PATHS: "/login",
            MONOCLE_HTTP_EXCLUDE_PATHS: "/login",
        }, () => {
            expect(isPathExcluded("http://[::1", "GET")).toBe(true);
        });
    });
});

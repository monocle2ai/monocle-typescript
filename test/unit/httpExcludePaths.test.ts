import { describe, it, expect, afterEach } from "vitest";
import { isPathExcluded, resetExcludedPathsForTests } from "../../src/instrumentation/http/excludePaths";

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

afterEach(() => resetExcludedPathsForTests());

describe("excluded paths", () => {
    it("excludes nothing when the variable is unset", () => {
        withEnv(undefined, () => {
            expect(isPathExcluded("/health")).toBe(false);
            expect(isPathExcluded("/api/v1/ask")).toBe(false);
        });
    });

    it("excludes nothing when the variable is empty or only separators", () => {
        withEnv("", () => expect(isPathExcluded("/health")).toBe(false));
        withEnv("  , ,, ", () => expect(isPathExcluded("/health")).toBe(false));
    });

    it("matches by prefix, so /health covers /health/ready", () => {
        withEnv("/health", () => {
            expect(isPathExcluded("/health")).toBe(true);
            expect(isPathExcluded("/health/ready")).toBe(true);
        });
    });

    it("handles a comma-separated list and trims whitespace", () => {
        withEnv(" /health , /metrics ", () => {
            expect(isPathExcluded("/health")).toBe(true);
            expect(isPathExcluded("/metrics")).toBe(true);
            expect(isPathExcluded("/api")).toBe(false);
        });
    });

    it("ignores the query string when matching", () => {
        withEnv("/health", () => expect(isPathExcluded("/health?verbose=1")).toBe(true));
    });

    // /health legitimately matches /healthcheck-api too: prefix matching is a
    // deliberate over-match, not a bug. A trailing slash is the escape hatch
    // that narrows a prefix to its own subtree.
    it("a bare prefix also matches a longer unrelated path segment", () => {
        withEnv("/health", () => expect(isPathExcluded("/healthcheck-api")).toBe(true));
    });

    it("a trailing slash narrows the prefix to the subtree", () => {
        withEnv("/health/", () => expect(isPathExcluded("/healthcheck-api")).toBe(false));
    });

    it("treats an absent url as not excluded", () => {
        withEnv("/health", () => expect(isPathExcluded(undefined)).toBe(false));
    });

    // Secrets case: this is the lever that makes unredacted body capture defensible.
    it("excludes a credential endpoint so its body is never captured", () => {
        withEnv("/login,/oauth/token", () => {
            expect(isPathExcluded("/login")).toBe(true);
            expect(isPathExcluded("/oauth/token")).toBe(true);
        });
    });
});

// Each case below is a real bypass a reviewer verified against a live Express
// server: case-insensitive routing, the absolute-form request target RFC 9112
// requires servers to accept, and path variants a router or static middleware
// normalises before matching. The exclude list has to see what the router sees.
describe("excluded paths — bypass resistance", () => {
    it("matches regardless of case, since Express routes case-insensitively", () => {
        withEnv("/login", () => {
            expect(isPathExcluded("/Login")).toBe(true);
            expect(isPathExcluded("/LOGIN")).toBe(true);
        });
    });

    it("matches the absolute-form request target Node passes through as-is", () => {
        withEnv("/login", () => {
            expect(isPathExcluded("http://127.0.0.1:3000/login")).toBe(true);
            expect(isPathExcluded("http://127.0.0.1:3000/login?x=1")).toBe(true);
        });
    });

    it("matches a percent-encoded path", () => {
        withEnv("/login", () => expect(isPathExcluded("/%6Cogin")).toBe(true));
    });

    it("matches a path with a duplicated leading slash", () => {
        withEnv("/login", () => expect(isPathExcluded("//login")).toBe(true));
    });

    it("matches a path with dot segments", () => {
        withEnv("/login", () => {
            expect(isPathExcluded("/x/../login")).toBe(true);
            expect(isPathExcluded("/./login")).toBe(true);
        });
    });

    it("excludes rather than traces when the request target cannot be resolved to a path", () => {
        withEnv("/login", () => expect(isPathExcluded("http://[::1")).toBe(true));
    });
});

// Normalising can also SHORTEN a path past a prefix that matched the raw
// form, which would silently stop excluding something the raw matcher used
// to cover. Matching is done against raw OR normalised so this can only add
// exclusions, never drop one.
describe("excluded paths — no regressions from normalising", () => {
    it("a trailing-slash prefix still excludes the subtree root itself", () => {
        withEnv("/login/", () => expect(isPathExcluded("/login/")).toBe(true));
    });

    it("a decoded '..' that walks back into an excluded prefix is still excluded", () => {
        withEnv("/health", () => expect(isPathExcluded("/health%2F..%2F..%2Flogin")).toBe(true));
    });
});

// A lowercase, query-free input would pass even if the raw branch lost its
// own .toLowerCase()/stripQuery() step, masked by the normalised branch's
// independent handling of both - the same shape of gap the two Criticals
// exploited. These two isolate the raw branch: prefix "/login/" has no
// normalised-branch match for either input, since normalising strips the
// trailing slash, leaving the raw branch as the only path to exclusion.
describe("excluded paths — raw branch isolation", () => {
    // Confirmed by removing .toLowerCase() from the raw branch: this fails.
    it("a cased input matches a trailing-slash prefix only via the raw branch's lowercasing", () => {
        withEnv("/login/", () => expect(isPathExcluded("/Login/")).toBe(true));
    });

    // NOT an isolation test for stripQuery(): the stripped raw string is
    // always a leading substring of the unstripped one, so a match on the
    // stripped form always survives on the unstripped form too. Confirmed by
    // removing stripQuery() from the raw branch: this case still passes.
    it("a trailing-slash prefix still matches when a query string follows it", () => {
        withEnv("/login/", () => expect(isPathExcluded("/login/?next=x")).toBe(true));
    });
});

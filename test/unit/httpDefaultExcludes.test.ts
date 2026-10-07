import { describe, it, expect, afterEach } from "vitest";
import {
    MASTRA_EXCLUDE_PATHS,
    UNIVERSAL_EXCLUDE_PATHS,
    defaultExcludePatterns,
    resetDefaultExcludesForTests,
} from "../../src/instrumentation/http/defaultExcludes";
import { getInstrumentor, setInstrumentor } from "../../src/instrumentation/common/utils";

// The real publication mechanism, not a mock: setupMonocle puts the
// instrumentor on globalThis and hookedPackages fills as patches fire.
function withHookedPackages(packages: string[], fn: () => void) {
    const previous = getInstrumentor();
    setInstrumentor({ hookedPackages: new Set(packages) });
    resetDefaultExcludesForTests();
    try { fn(); } finally {
        setInstrumentor(previous);
        resetDefaultExcludesForTests();
    }
}

afterEach(() => resetDefaultExcludesForTests());

describe("default excludes — universal tier", () => {
    it("applies with no instrumentor published at all", () => {
        withHookedPackages([], () => {
            setInstrumentor(undefined);
            resetDefaultExcludesForTests();
            expect(defaultExcludePatterns()).toEqual(expect.arrayContaining([...UNIVERSAL_EXCLUDE_PATHS]));
        });
    });

    it("covers the build, dev-tooling and browser noise seen in real traces", () => {
        expect(UNIVERSAL_EXCLUDE_PATHS).toEqual(
            expect.arrayContaining(["/_next/", "/__nextjs", "/.well-known/", "/assets/", "/favicon.ico$"]),
        );
    });
});

describe("default excludes — framework gating", () => {
    it("leaves Mastra's routes alone when Mastra is not in the process", () => {
        withHookedPackages(["@langchain/core"], () => {
            const active = defaultExcludePatterns();
            for (const pattern of MASTRA_EXCLUDE_PATHS) expect(active).not.toContain(pattern);
        });
    });

    it("adds Mastra's routes once @mastra/core has been hooked", () => {
        withHookedPackages(["@mastra/core"], () => {
            expect(defaultExcludePatterns()).toEqual(expect.arrayContaining([...MASTRA_EXCLUDE_PATHS]));
        });
    });

    // hookedPackages fills as modules load. Caching the first "no" would
    // permanently disable the Mastra tier for a process that simply had not
    // loaded Mastra yet when its first request arrived.
    it("does not cache a negative detection", () => {
        const previous = getInstrumentor();
        try {
            const hooked = new Set<string>();
            setInstrumentor({ hookedPackages: hooked });
            resetDefaultExcludesForTests();

            expect(defaultExcludePatterns()).not.toContain(MASTRA_EXCLUDE_PATHS[0]);
            hooked.add("@mastra/core");
            expect(defaultExcludePatterns()).toContain(MASTRA_EXCLUDE_PATHS[0]);
        } finally {
            setInstrumentor(previous);
            resetDefaultExcludesForTests();
        }
    });

    it("survives an instrumentor that has no hookedPackages yet", () => {
        const previous = getInstrumentor();
        try {
            setInstrumentor({});
            resetDefaultExcludesForTests();
            expect(() => defaultExcludePatterns()).not.toThrow();
            expect(defaultExcludePatterns()).not.toContain(MASTRA_EXCLUDE_PATHS[0]);
        } finally {
            setInstrumentor(previous);
            resetDefaultExcludesForTests();
        }
    });
});

// Same reasoning as the health check route list: plenty of apps serve real
// traffic at "/", so it is never excluded by default.
describe("default excludes — what is deliberately absent", () => {
    it("never excludes the root path", () => {
        withHookedPackages(["@mastra/core"], () => {
            expect(defaultExcludePatterns()).not.toContain("/");
            expect(defaultExcludePatterns()).not.toContain("/$");
        });
    });
});

import { describe, it, expect } from "vitest";
import { compilePattern } from "../../src/instrumentation/http/pathPattern";

function match(pattern: string, path: string): boolean {
    const compiled = compilePattern(pattern);
    if (!compiled) throw new Error(`pattern did not compile: ${JSON.stringify(pattern)}`);
    return compiled(path);
}

// A pattern with neither $ nor * must behave exactly as it did before this
// grammar existed, or every deployed MONOCLE_HTTP_EXCLUDE_PATHS changes meaning.
describe("path pattern — plain patterns stay character prefixes", () => {
    it("matches the path itself and anything beneath it", () => {
        expect(match("/health", "/health")).toBe(true);
        expect(match("/health", "/health/ready")).toBe(true);
    });

    it("still over-matches a longer unrelated segment, as prefixes always did", () => {
        expect(match("/health", "/healthcheck-api")).toBe(true);
    });

    it("still narrows to the subtree when given a trailing slash", () => {
        expect(match("/health/", "/healthcheck-api")).toBe(false);
        expect(match("/health/", "/health/ready")).toBe(true);
    });
});

describe("path pattern — $ means exact", () => {
    it("matches only the path itself", () => {
        expect(match("/api/agents$", "/api/agents")).toBe(true);
    });

    // The reason $ exists: /api/agents is Mastra playground noise while
    // /api/agents/<id>/send-message is the only real traffic under it.
    it("does not match anything beneath it", () => {
        expect(match("/api/agents$", "/api/agents/weather-agent")).toBe(false);
        expect(match("/api/agents$", "/api/agents/weather-agent/send-message")).toBe(false);
    });

    it("does not match a longer sibling segment", () => {
        expect(match("/api/agents$", "/api/agentsx")).toBe(false);
    });
});

describe("path pattern — * means exactly one segment", () => {
    it("matches any single segment in that position", () => {
        expect(match("/api/agents/*$", "/api/agents/weather-agent")).toBe(true);
        expect(match("/api/agents/*$", "/api/agents/providers")).toBe(true);
    });

    it("does not span a slash, so the real route survives", () => {
        expect(match("/api/agents/*$", "/api/agents/weather-agent/send-message")).toBe(false);
    });

    it("matches a parameter in the middle of a pattern", () => {
        expect(match("/api/agents/*/voice/speakers$", "/api/agents/weather-agent/voice/speakers")).toBe(true);
        expect(match("/api/agents/*/voice/speakers$", "/api/agents/other/voice/speakers")).toBe(true);
    });

    it("requires the segments after the wildcard to match too", () => {
        expect(match("/api/agents/*/voice/speakers$", "/api/agents/weather-agent/voice/other")).toBe(false);
        expect(match("/api/agents/*/voice/speakers$", "/api/agents/weather-agent/send-message")).toBe(false);
    });

    it("without $, matches the prefix depth and anything beneath", () => {
        expect(match("/api/agents/*/voice", "/api/agents/x/voice")).toBe(true);
        expect(match("/api/agents/*/voice", "/api/agents/x/voice/speakers")).toBe(true);
        expect(match("/api/agents/*/voice", "/api/agents/x/tools")).toBe(false);
    });

    it("needs a segment to be present, not merely possible", () => {
        expect(match("/api/agents/*$", "/api/agents")).toBe(false);
    });
});

describe("path pattern — inputs that are not patterns", () => {
    it("does not compile an empty or whitespace-only pattern", () => {
        expect(compilePattern("")).toBeNull();
        expect(compilePattern("   ")).toBeNull();
    });

    // "$" alone would otherwise compile to "exact match on the empty string".
    it("does not compile a bare $", () => {
        expect(compilePattern("$")).toBeNull();
    });

    it("trims surrounding whitespace", () => {
        expect(match("  /health  ", "/health")).toBe(true);
    });
});

// Mastra's playground noise is entirely GET while the real agent call is a
// POST to a path underneath it, so path alone cannot separate them.
describe("path pattern — an optional leading method", () => {
    function matchM(pattern: string, path: string, method?: string): boolean {
        const compiled = compilePattern(pattern);
        if (!compiled) throw new Error(`pattern did not compile: ${JSON.stringify(pattern)}`);
        return compiled(path, method);
    }

    it("matches only that method", () => {
        expect(matchM("get /api/", "/api/agents", "GET")).toBe(true);
        expect(matchM("get /api/", "/api/agents", "POST")).toBe(false);
    });

    it("compares the method case-insensitively", () => {
        expect(matchM("get /api/", "/api/agents", "get")).toBe(true);
    });

    it("keeps the real agent call while excluding the listing above it", () => {
        expect(matchM("get /api/", "/api/agents/weather-agent/send-message", "POST")).toBe(false);
        expect(matchM("get /api/", "/api/agents", "GET")).toBe(true);
    });

    it("still applies the rest of the grammar after the method", () => {
        expect(matchM("get /$", "/", "GET")).toBe(true);
        expect(matchM("get /$", "/api", "GET")).toBe(false);
    });

    // An unknown method must not satisfy a method-qualified pattern: excluding
    // on a guess would drop a span we cannot prove is noise.
    it("does not match when the request method is unknown", () => {
        expect(matchM("get /api/", "/api/agents", undefined)).toBe(false);
    });

    // Every pattern written before this existed has no method and must keep
    // matching regardless of one.
    it("matches any method when the pattern does not name one", () => {
        expect(matchM("/api/", "/api/agents", "GET")).toBe(true);
        expect(matchM("/api/", "/api/agents", "DELETE")).toBe(true);
        expect(matchM("/api/", "/api/agents", undefined)).toBe(true);
    });
});

// Without $, a pattern is a prefix. In segment mode that has to reach into
// the final segment too, or /api/agents/*/stream cannot cover the seven
// stream variants Mastra declares (stream-legacy, streamVNext, stream/ui...).
describe("path pattern — segment mode ends in a character prefix", () => {
    it("matches a final segment that merely starts with the pattern's", () => {
        expect(match("/api/agents/*/stream", "/api/agents/x/stream")).toBe(true);
        expect(match("/api/agents/*/stream", "/api/agents/x/stream-legacy")).toBe(true);
        expect(match("/api/agents/*/stream", "/api/agents/x/streamVNext")).toBe(true);
        expect(match("/api/agents/*/stream", "/api/agents/x/stream/vnext/ui")).toBe(true);
    });

    it("still requires earlier segments to match whole", () => {
        expect(match("/api/agents/*/stream", "/api/agentsx/y/stream")).toBe(false);
        expect(match("/api/agents/*/stream", "/api/agents/x/threads/subscribe")).toBe(false);
    });

    it("keeps $ meaning the whole final segment and depth", () => {
        expect(match("/api/agents/*/stream$", "/api/agents/x/stream")).toBe(true);
        expect(match("/api/agents/*/stream$", "/api/agents/x/stream-legacy")).toBe(false);
    });
});

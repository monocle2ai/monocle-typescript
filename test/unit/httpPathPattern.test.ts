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

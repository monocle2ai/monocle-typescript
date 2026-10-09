// Built-in exclude patterns, derived from real traces: a Mastra playground
// session produced 48 spans of which 1 was real traffic, and a Next.js app
// 151 of which 36 were. See pathPattern.ts for the grammar.

import { getInstrumentor } from "../common/utils";

// Framework build output, dev tooling and browser incidentals. Safe in any
// app: none of these ever carry instrumented work.
export const UNIVERSAL_EXCLUDE_PATHS: readonly string[] = [
    "/_next/",          // Next build output, static chunks, HMR
    "/__nextjs",        // /__nextjs_source-map, /__nextjs_original-stack-frame
    "/assets/",         // Vite build output, which Mastra's playground serves
    "/.well-known/",    // Chrome devtools probe, ACME, discovery documents
    "/favicon.ico$",
];

// Mastra's playground/studio API. Gated on Mastra actually being loaded,
// because "/api/agents" and "/api/tools" are plausible real routes elsewhere.
export const MASTRA_EXCLUDE_PATHS: readonly string[] = [
    // The whole /api namespace is Mastra's own. Custom routes registered via
    // registerApiRoute() mount at the root with prefix "", so excluding all of
    // /api cannot touch anything the application wrote - only MASTRA_KEEP_PATHS
    // below decides what comes back.
    "/api/",
    "GET /$",        // the playground UI itself
    "GET /mastra-",  // root-level branded assets, e.g. /mastra-dark-tile.svg
    // Dev-server endpoints. Method-blind: unambiguous paths, nothing else
    // should ever serve them.
    "/__refresh$",
    "/__restart-active-workflow-runs$",
];

// Rescued from the blanket /api deny above, because these are the endpoints
// that actually run an agent, workflow or tool.
//
// A keep-list rather than a noise list because the noise is 228 routes across
// 15 groups and grows with every playground feature, while this surface is
// Mastra's public contract. Three rounds of enumerating noise from traces
// leaked /api/workspaces, /api/channels/platforms and .../threads/subscribe.
//
// Derived from @mastra/server's createRoute() table and pinned by a test that
// replays all 52 execution routes: a missed entry loses a real trace, which is
// much worse than a noisy span getting through.
export const MASTRA_KEEP_PATHS: readonly string[] = [
    // No trailing $, so each final segment is a prefix: "stream" covers
    // stream-legacy, stream-until-idle, streamVNext and stream/vnext/ui.
    "/api/agents/*/send",            // send-message, send-tool-approval
    "/api/agents/*/generate",
    "/api/agents/*/stream",
    "/api/agents/*/resume",
    "/api/agents/*/approve",
    "/api/agents/*/decline",
    "/api/agents/*/network",
    "/api/agents/*/observe",
    "/api/agents/*/signals",
    "/api/agents/*/queue-message",
    "/api/agents/*/tools/*/execute",
    "/api/workflows/*/start",
    "/api/workflows/*/resume",
    "/api/workflows/*/stream",
    "/api/workflows/*/observe",
    "/api/workflows/*/time-travel-stream",
    "/api/workflows/*/runs/*/steps/execute",
    "/api/agent-builder/*/start",
    "/api/agent-builder/*/resume",
    "/api/agent-builder/*/stream",
    "/api/agent-builder/*/observe",
    "/api/agent-controller/*/sessions/*/stream",
    "/api/tools/*/execute",
    "/api/processors/*/execute",
    "/api/mcp/*/tools/*/execute",
    "/api/datasets/*/generate-items",
];

// The bare name getBarePackageName() derives from the metamodel's
// "@mastra/core/agent". Pinned by a test, since a rename here fails silent.
export const MASTRA_PACKAGE = "@mastra/core";

const EMPTY: readonly string[] = [];

let mastraDetected = false;
let combined: readonly string[] | null = null;

// hookedPackages fills as each patch fires, so a "no" here only means "not
// yet". Only the positive is cached; the Set lookup is cheap enough to repeat.
function isMastraLoaded(): boolean {
    if (mastraDetected) return true;
    try {
        if (getInstrumentor()?.hookedPackages?.has(MASTRA_PACKAGE)) mastraDetected = true;
    } catch {
        // A malformed instrumentor must not take the request down.
    }
    return mastraDetected;
}

// The returned array is reference-stable for a given detection state, so
// callers can cache compiled patterns against its identity.
export function defaultExcludePatterns(): readonly string[] {
    if (!isMastraLoaded()) return UNIVERSAL_EXCLUDE_PATHS;
    if (!combined) combined = [...UNIVERSAL_EXCLUDE_PATHS, ...MASTRA_EXCLUDE_PATHS];
    return combined;
}

// Patterns that win over every exclusion. Today only Mastra populates this;
// the user-facing allow list will join it here.
export function defaultAllowPatterns(): readonly string[] {
    return isMastraLoaded() ? MASTRA_KEEP_PATHS : EMPTY;
}

export function resetDefaultExcludesForTests(): void {
    mastraDetected = false;
    combined = null;
}

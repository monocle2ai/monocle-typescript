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
//
// The agent routes are the reason the grammar has * and $: the agent id is a
// path parameter, so noise and signal interleave under one prefix.
// /api/agents/*$ catches the detail GET at exactly that depth, which leaves
// /api/agents/<id>/send-message - the only real span in the trace set - alone.
export const MASTRA_EXCLUDE_PATHS: readonly string[] = [
    "/api/agents$",
    "/api/agents/*$",
    "/api/agents/*/voice/speakers$",
    "/api/memory/",
    "/api/editor/",
    "/api/system/",
    "/api/scores/",
    "/api/workflows$",
    "/api/tools$",
    "/api/processors$",
    "/api/auth/capabilities$",
    "/api/mcp/v0/servers$",
    "/__refresh$",
    "/__restart-active-workflow-runs$",
];

const MASTRA_PACKAGE = "@mastra/core";

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

export function resetDefaultExcludesForTests(): void {
    mastraDetected = false;
    combined = null;
}

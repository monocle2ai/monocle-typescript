// Grammar for exclude-list patterns. Both extensions are opt-in, so a pattern
// with neither behaves exactly as it did when this was a bare startsWith -
// every already-deployed MONOCLE_HTTP_EXCLUDE_PATHS keeps its meaning.
//
//   /auth/login                   character prefix (also /auth/login-v2)
//   /api/agents$                  exact
//   /api/agents/*$                one segment, exact depth
//   /api/agents/*/voice/speakers$ parameter in the middle
//
// Patterns are compiled once; the returned predicate runs on every request.

export type CompiledPattern = (path: string) => boolean;

function segments(path: string): string[] {
    return path.split("/").filter((s) => s.length > 0);
}

// Character prefix, not segment prefix: /health matching /healthcheck-api is
// the documented behaviour, and a trailing slash is the escape hatch from it.
function stringMatcher(body: string, exact: boolean): CompiledPattern {
    return exact ? (path) => path === body : (path) => path.startsWith(body);
}

function segmentMatcher(body: string, exact: boolean): CompiledPattern {
    const pattern = segments(body);
    return (path) => {
        const actual = segments(path);
        // Without $ the pattern is a prefix, so trailing segments are allowed;
        // with it the depth has to agree exactly.
        if (exact ? actual.length !== pattern.length : actual.length < pattern.length) return false;
        return pattern.every((seg, i) => seg === "*" || seg === actual[i]);
    };
}

// null for anything that is not a usable pattern - an empty entry, or a bare
// "$", which would otherwise compile to "exact match on the empty string" and
// exclude nothing while looking like it excludes something.
export function compilePattern(raw: string): CompiledPattern | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const exact = trimmed.endsWith("$");
    const body = exact ? trimmed.slice(0, -1) : trimmed;
    if (!body) return null;
    return body.includes("*") ? segmentMatcher(body, exact) : stringMatcher(body, exact);
}

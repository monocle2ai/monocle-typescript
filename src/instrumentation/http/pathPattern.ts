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

export type CompiledPattern = (path: string, method?: string) => boolean;

// An optional "GET " in front of the path. Patterns are paths, so they always
// begin with "/" - a bare word before whitespace can only be a method.
const METHOD_PREFIX = /^([a-zA-Z]+)\s+(\/.*)$/;

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
    const last = pattern.length - 1;
    return (path) => {
        const actual = segments(path);
        // Without $ the pattern is a prefix, so trailing segments are allowed;
        // with it the depth has to agree exactly.
        if (exact ? actual.length !== pattern.length : actual.length < pattern.length) return false;
        return pattern.every((seg, i) => {
            if (seg === "*") return true;
            // A $-less pattern is a prefix, and that reaches into its final
            // segment: /api/agents/*/stream has to cover stream-legacy and
            // streamVNext, which are siblings rather than children.
            return !exact && i === last ? actual[i].startsWith(seg) : seg === actual[i];
        });
    };
}

// null for anything that is not a usable pattern - an empty entry, or a bare
// "$", which would otherwise compile to "exact match on the empty string" and
// exclude nothing while looking like it excludes something.
export function compilePattern(raw: string): CompiledPattern | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const withMethod = METHOD_PREFIX.exec(trimmed);
    const method = withMethod ? withMethod[1].toLowerCase() : null;
    const rest = withMethod ? withMethod[2] : trimmed;

    const exact = rest.endsWith("$");
    const body = exact ? rest.slice(0, -1) : rest;
    if (!body) return null;
    const matchesPath = body.includes("*") ? segmentMatcher(body, exact) : stringMatcher(body, exact);

    if (!method) return matchesPath;
    // An unknown method never satisfies a method-qualified pattern: excluding
    // on a guess would drop a span we cannot show is noise.
    return (path, requestMethod) =>
        typeof requestMethod === "string" &&
        requestMethod.toLowerCase() === method &&
        matchesPath(path);
}

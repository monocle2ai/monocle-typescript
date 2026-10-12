import { MONOCLE_HTTP_EXCLUDE_PATHS_ENV } from "./constants";
import { stripQuery } from "./capture";

// Read once: this runs on every request, and the variable cannot change
// meaningfully mid-process. resetExcludedPathsForTests clears the cache.
// Lowercased: Express (our reference framework) routes case-insensitively by
// default, so a case-sensitive prefix would let "/Login" through unmatched.
let cached: string[] | null = null;

// Lowercased only, never further normalised: normalising "/login/" to
// "/login" here would destroy the trailing-slash escape hatch that narrows a
// bare prefix's over-match to its own subtree.
function excludedPrefixes(): string[] {
    if (cached) return cached;
    cached = (process.env[MONOCLE_HTTP_EXCLUDE_PATHS_ENV] ?? "")
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p.length > 0);
    return cached;
}

export function resetExcludedPathsForTests(): void {
    cached = null;
}

// req.url is "/path" for the common origin-form request target, but RFC 9112
// permits the absolute-form ("http://host/path") and Node passes it through
// unchanged; a framework's router still resolves it to the same handler.
// Returns null when it cannot be parsed at all.
function toPathname(url: string): string | null {
    if (url.startsWith("/")) return stripQuery(url);
    try {
        return new URL(url).pathname;
    } catch {
        return null;
    }
}

// decodeURIComponent throws on a malformed escape (e.g. a lone "%"); the raw,
// still-encoded form is kept rather than failing the whole match.
function safeDecode(path: string): string {
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
}

// Collapses "//" and resolves "." / ".." segments so "/x/../login" and
// "//login" are compared as "/login", the same way a downstream router or
// static-file middleware would ultimately see them.
function collapseSegments(path: string): string {
    const resolved: string[] = [];
    for (const segment of path.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") resolved.pop();
        else resolved.push(segment);
    }
    return `/${resolved.join("/")}`;
}

// Single definition of "the path we match against": lowercased, decoded,
// query-stripped, slash-collapsed, dot-segment-resolved. Returns null only
// when the request target itself could not be resolved to a path at all.
function normalizePath(url: string): string | null {
    const pathname = toPathname(url);
    if (pathname === null) return null;
    return collapseSegments(safeDecode(pathname)).toLowerCase();
}

// Matched against BOTH the raw target and the normalised path: normalising
// can shorten a path (a trailing slash, a decoded "..") past a prefix that
// matched the raw form, so matching only one would stop excluding it. Either
// matching is monotonic - only adds exclusions - so this is a superset of both.
export function isPathExcluded(url: string | undefined): boolean {
    const prefixes = excludedPrefixes();
    if (!prefixes.length || typeof url !== "string") return false;
    const path = normalizePath(url);
    // Cannot be resolved to a path at all: exclude rather than trace, since
    // ambiguity should favour keeping a secret out over tracing a request.
    if (path === null) return true;
    const raw = stripQuery(url).toLowerCase();
    return prefixes.some((prefix) => raw.startsWith(prefix) || path.startsWith(prefix));
}

import { MONOCLE_HTTP_EXCLUDE_PATHS_ENV } from "./constants";
import { stripQuery } from "./capture";
import { CompiledPattern, compilePattern } from "./pathPattern";
import { defaultAllowPatterns, defaultExcludePatterns, resetDefaultExcludesForTests } from "./defaultExcludes";

// Two deny sources, unioned: the built-in defaults and the user's list. The
// user's list only ever adds - it cannot rescue a path a default caught. That
// is the allow list's job, and it is not built yet.
let userCompiled: CompiledPattern[] | null = null;
let defaultsSource: readonly string[] | null = null;
let defaultsCompiled: CompiledPattern[] = [];
let allowSource: readonly string[] | null = null;
let allowCompiled: CompiledPattern[] = [];

// Lowercased, never further normalised: normalising "/login/" to "/login"
// would destroy the trailing-slash escape hatch that narrows a bare prefix's
// over-match to its own subtree. Unusable entries are dropped.
function compileAll(patterns: readonly string[]): CompiledPattern[] {
    return patterns
        .map((p) => compilePattern(p.toLowerCase()))
        .filter((m): m is CompiledPattern => m !== null);
}

// Read once: this runs on every request and the variable cannot change
// meaningfully mid-process.
function userPatterns(): CompiledPattern[] {
    if (!userCompiled) {
        userCompiled = compileAll((process.env[MONOCLE_HTTP_EXCLUDE_PATHS_ENV] ?? "").split(","));
    }
    return userCompiled;
}

// Recompiled only when the default list itself changes, which happens at most
// once per process - when a framework is detected and its tier switches on.
function defaultPatterns(): CompiledPattern[] {
    const source = defaultExcludePatterns();
    if (source !== defaultsSource) {
        defaultsSource = source;
        defaultsCompiled = compileAll(source);
    }
    return defaultsCompiled;
}

function allowPatterns(): CompiledPattern[] {
    const source = defaultAllowPatterns();
    if (source !== allowSource) {
        allowSource = source;
        allowCompiled = compileAll(source);
    }
    return allowCompiled;
}

export function resetExcludedPathsForTests(): void {
    userCompiled = null;
    defaultsSource = null;
    defaultsCompiled = [];
    allowSource = null;
    allowCompiled = [];
    resetDefaultExcludesForTests();
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
// can shorten a path past a pattern that matched the raw form, so matching
// only one would stop excluding it. Either matching is monotonic - it only
// adds exclusions - so this is a superset of both.
function matchesAny(
    matchers: CompiledPattern[], raw: string, path: string, method?: string,
): boolean {
    return matchers.some((matches) => matches(raw, method) || matches(path, method));
}

export function isPathExcluded(url: string | undefined, method?: string): boolean {
    const defaults = defaultPatterns();
    const user = userPatterns();
    if (typeof url !== "string" || (!defaults.length && !user.length)) return false;

    const path = normalizePath(url);
    if (path === null) {
        // Unresolvable target: exclude only if the user configured a list, since
        // that list is the lever for keeping a credential endpoint's body out of
        // an exporter and ambiguity there should favour the secret. The defaults
        // exist to cut noise, which is no reason to drop an odd request.
        return user.length > 0;
    }

    const raw = stripQuery(url).toLowerCase();
    // Allow wins over every exclusion. The user-facing allow list will be
    // evaluated here too, alongside the framework one.
    if (matchesAny(allowPatterns(), raw, path, method)) return false;
    return matchesAny(defaults, raw, path, method) || matchesAny(user, raw, path, method);
}

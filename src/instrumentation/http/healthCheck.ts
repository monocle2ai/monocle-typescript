// Health check span sampling, ported from monocle_apptrace's HttpSpanHandler.
// Pure string functions plus the counter state - reading the span is the
// handler's job, so nothing here imports OpenTelemetry.

export const MONOCLE_SAMPLE_HEALTH_CHECKS_ENV = "MONOCLE_SAMPLE_HEALTH_CHECKS";
export const MONOCLE_HEALTH_CHECK_ROUTES_ENV = "MONOCLE_HEALTH_CHECK_ROUTES";
export const MONOCLE_HEALTH_CHECK_SAMPLE_RATE_ENV = "MONOCLE_HEALTH_CHECK_SAMPLE_RATE";

// Upstream's HTTP_HEALTH_CHECK_ROUTES verbatim. "/" is omitted deliberately:
// plenty of apps serve real traffic there, so it has to be opted in.
export const HTTP_HEALTH_CHECK_ROUTES: readonly string[] = [
    "/health", "/healthz", "/healthcheck", "/health-check", "/livez",
    "/liveness", "/readyz", "/readiness", "/ping", "/_health",
];

const DEFAULT_SAMPLE_RATE = 100;

let cachedRoutes: string[] | null = null;
let cachedRate: number | null = null;
const counters = new Map<string, number>();

function normalize(path: string): string {
    const query = path.indexOf("?");
    const withoutQuery = query === -1 ? path : path.slice(0, query);
    return withoutQuery.replace(/\/+$/, "").toLowerCase() || "/";
}

function routes(): string[] {
    if (cachedRoutes) return cachedRoutes;
    const configured = process.env[MONOCLE_HEALTH_CHECK_ROUTES_ENV];
    // Replaces rather than extends, as upstream does: this list is one
    // concept, unlike MONOCLE_HTTP_EXCLUDE_PATHS which mixes noise and secrets.
    const source = configured === undefined
        ? [...HTTP_HEALTH_CHECK_ROUTES]
        : configured.split(",");
    cachedRoutes = source.map((r) => r.trim()).filter((r) => r.length > 0).map(normalize);
    return cachedRoutes;
}

export function isHealthCheckSamplingEnabled(): boolean {
    return (process.env[MONOCLE_SAMPLE_HEALTH_CHECKS_ENV] ?? "true").toLowerCase() === "true";
}

export function healthCheckSampleRate(): number {
    if (cachedRate !== null) return cachedRate;
    const raw = process.env[MONOCLE_HEALTH_CHECK_SAMPLE_RATE_ENV];
    if (raw === undefined) {
        cachedRate = DEFAULT_SAMPLE_RATE;
        return cachedRate;
    }
    // Blank counts as unparseable: Number("") is 0, which is finite, so an
    // empty value left in a .env file would otherwise disable sampling
    // entirely and say nothing. console.warn, not consoleLog, because
    // consoleLog is gated behind MONOCLE_DEBUG and a misconfigured rate is
    // exactly what someone needs told without opting in to debug output.
    const parsed = raw.trim() === "" ? NaN : Number(raw);
    if (!Number.isFinite(parsed)) {
        console.warn(
            `[monocle] ${MONOCLE_HEALTH_CHECK_SAMPLE_RATE_ENV}="${raw}" is not a number; using ${DEFAULT_SAMPLE_RATE}`,
        );
        cachedRate = DEFAULT_SAMPLE_RATE;
        return cachedRate;
    }
    cachedRate = Math.trunc(parsed);
    return cachedRate;
}

// The configured route a path matched, or null. Exact or suffix, so
// /actuator/health matches /health. An empty route is not a probe: getRoute()
// degrades to "" when the target cannot be resolved, and matching that would
// sample away traffic nobody configured.
//
// Returns the matched route rather than a boolean because it is also the
// counter key - see takeSample.
export function matchedHealthCheckRoute(route: string): string | null {
    if (typeof route !== "string" || route.length === 0) return null;
    const path = normalize(route);
    return routes().find((known) => path === known || path.endsWith(known)) ?? null;
}

export function isHealthCheckRoute(route: string): boolean {
    return matchedHealthCheckRoute(route) !== null;
}

// true means "export this one" - deterministic, exactly one in every `rate`.
// The first call for a key always returns true, so a route never looks dead
// while it waits for its first sample.
//
// `key` is the MATCHED configured route, or "" for everything else, so the map
// is bounded by the route list. Keying on the request path instead would let
// /tenant-1/health, /tenant-2/health ... grow it without bound - and hand each
// one a free first-request export, defeating the sampler as it went.
export function takeSample(key: string): boolean {
    const rate = healthCheckSampleRate();
    if (rate < 2) return true;
    const next = ((counters.get(key) ?? rate - 1) + 1) % rate;
    counters.set(key, next);
    return next === 0;
}

export function resetHealthCheckStateForTests(): void {
    cachedRoutes = null;
    cachedRate = null;
    counters.clear();
}

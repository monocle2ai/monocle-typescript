import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    HTTP_HEALTH_CHECK_ROUTES, healthCheckSampleRate, isHealthCheckRoute,
    isHealthCheckSamplingEnabled, resetHealthCheckStateForTests, takeSample,
} from "../../src/instrumentation/http/healthCheck";

const ENV_KEYS = [
    "MONOCLE_SAMPLE_HEALTH_CHECKS",
    "MONOCLE_HEALTH_CHECK_ROUTES",
    "MONOCLE_HEALTH_CHECK_SAMPLE_RATE",
];

beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    resetHealthCheckStateForTests();
});
afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    resetHealthCheckStateForTests();
});

describe("the default route list", () => {
    it("is upstream's ten, unchanged", () => {
        expect([...HTTP_HEALTH_CHECK_ROUTES]).toEqual([
            "/health", "/healthz", "/healthcheck", "/health-check", "/livez",
            "/liveness", "/readyz", "/readiness", "/ping", "/_health",
        ]);
    });

    // Plenty of apps serve real traffic at "/".
    it("does not include the root path", () => {
        expect(HTTP_HEALTH_CHECK_ROUTES).not.toContain("/");
    });
});

describe("route matching", () => {
    it("matches a route exactly", () => {
        expect(isHealthCheckRoute("/healthz")).toBe(true);
    });

    it("matches a path that ends with a route", () => {
        expect(isHealthCheckRoute("/actuator/health")).toBe(true);
        expect(isHealthCheckRoute("/api/v1/healthz")).toBe(true);
    });

    it("ignores case and a trailing slash", () => {
        expect(isHealthCheckRoute("/Healthz/")).toBe(true);
    });

    // Prefix matching would wrongly catch this; suffix matching must not.
    it("does not match a longer word starting with a route", () => {
        expect(isHealthCheckRoute("/healthcheck-api")).toBe(false);
    });

    // getRoute() degrades to "" for an unparseable target.
    it("treats an empty route as not a probe", () => {
        expect(isHealthCheckRoute("")).toBe(false);
    });

    it("does not match the root path by default", () => {
        expect(isHealthCheckRoute("/")).toBe(false);
    });
});

describe("MONOCLE_HEALTH_CHECK_ROUTES", () => {
    it("replaces the defaults rather than adding to them", () => {
        process.env.MONOCLE_HEALTH_CHECK_ROUTES = "/status-check";
        expect(isHealthCheckRoute("/status-check")).toBe(true);
        expect(isHealthCheckRoute("/healthz")).toBe(false);
    });

    it("trims blanks, lowercases and strips trailing slashes", () => {
        process.env.MONOCLE_HEALTH_CHECK_ROUTES = "/Health, ,/readyz/";
        expect(isHealthCheckRoute("/health")).toBe(true);
        expect(isHealthCheckRoute("/readyz")).toBe(true);
        expect(isHealthCheckRoute("/healthz")).toBe(false);
    });

    it("lets the root path be opted in", () => {
        process.env.MONOCLE_HEALTH_CHECK_ROUTES = "/healthz,/";
        expect(isHealthCheckRoute("/")).toBe(true);
    });
});

describe("MONOCLE_SAMPLE_HEALTH_CHECKS", () => {
    it("is on by default", () => {
        expect(isHealthCheckSamplingEnabled()).toBe(true);
    });

    it("is off when set to anything but true", () => {
        process.env.MONOCLE_SAMPLE_HEALTH_CHECKS = "false";
        expect(isHealthCheckSamplingEnabled()).toBe(false);
    });

    it("compares case-insensitively, as upstream does", () => {
        process.env.MONOCLE_SAMPLE_HEALTH_CHECKS = "TRUE";
        expect(isHealthCheckSamplingEnabled()).toBe(true);
    });
});

describe("the sample counter", () => {
    // Start the counter at 0 instead and a process shows no evidence the
    // endpoint exists for its first hundred probes.
    it("always exports the first request on a route", () => {
        expect(takeSample("/healthz")).toBe(true);
    });

    it("drops the next rate-1 requests and exports the one after", () => {
        process.env.MONOCLE_HEALTH_CHECK_SAMPLE_RATE = "5";
        const kept = [];
        for (let i = 0; i < 11; i++) if (takeSample("/healthz")) kept.push(i);
        expect(kept).toEqual([0, 5, 10]);
    });

    // A 5s readiness probe must not consume the slots a 10s liveness probe needs.
    it("counts each route independently", () => {
        process.env.MONOCLE_HEALTH_CHECK_SAMPLE_RATE = "3";
        expect(takeSample("/healthz")).toBe(true);
        expect(takeSample("/readyz")).toBe(true);
        expect(takeSample("/healthz")).toBe(false);
        expect(takeSample("/readyz")).toBe(false);
    });

    // Any contentless GET is sampled, so a per-path counter would grow without
    // bound under a crawler. "" is the shared key.
    it("shares one bucket for everything that is not a configured probe", () => {
        process.env.MONOCLE_HEALTH_CHECK_SAMPLE_RATE = "2";
        expect(takeSample("")).toBe(true);
        expect(takeSample("")).toBe(false);
        expect(takeSample("")).toBe(true);
    });
});

describe("MONOCLE_HEALTH_CHECK_SAMPLE_RATE", () => {
    it("defaults to 100", () => {
        expect(healthCheckSampleRate()).toBe(100);
    });

    it("falls back to 100 when unparseable, rather than throwing", () => {
        process.env.MONOCLE_HEALTH_CHECK_SAMPLE_RATE = "banana";
        expect(healthCheckSampleRate()).toBe(100);
    });

    it("exports everything when set below 2", () => {
        for (const value of ["1", "0", "-5"]) {
            process.env.MONOCLE_HEALTH_CHECK_SAMPLE_RATE = value;
            resetHealthCheckStateForTests();
            expect(takeSample("/healthz"), `rate=${value}`).toBe(true);
            expect(takeSample("/healthz"), `rate=${value}`).toBe(true);
        }
    });
});

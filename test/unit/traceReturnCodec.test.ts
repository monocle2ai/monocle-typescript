import { describe, it, expect } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import {
    makeDelimiter,
    encodeSpans,
    decodePayload,
    buildTrailerBytes,
    buildResponseHeaderValue,
    parseDelimiterFromHeader,
    splitBodyAndTrailer,
} from "../../src/traceReturn/codec";

function mkSpan(overrides: any = {}): any {
    return {
        name: "agentic.turn",
        spanContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 }),
        kind: SpanKind.SERVER,
        parentSpanContext: undefined,
        startTime: [1754938891, 480000000],
        endTime: [1754938896, 579000000],
        status: { code: 1, message: "OK" },
        attributes: { "span.type": "agentic.turn", "entity.1.name": "math_agent" },
        events: [],
        links: [],
        resource: { attributes: { SERVICE_NAME: "a2a.server" } },
        ...overrides,
    };
}

describe("delimiter", () => {
    it("matches trace_return.py's shape: prefix + uuid4().hex + suffix", () => {
        expect(makeDelimiter()).toMatch(/^__MONOCLE_TRACES__[0-9a-f]{32}__$/);
    });

    it("is fresh per response", () => {
        expect(makeDelimiter()).not.toBe(makeDelimiter());
    });
});

describe("response header", () => {
    it("emits the 'v1; delim=<d>' grammar", () => {
        expect(buildResponseHeaderValue("__MONOCLE_TRACES__abc__")).toBe(
            "v1; delim=__MONOCLE_TRACES__abc__",
        );
    });

    it("round-trips through the parser", () => {
        const d = makeDelimiter();
        expect(parseDelimiterFromHeader(buildResponseHeaderValue(d))).toBe(d);
    });

    it("takes everything after the first marker, as Python's split(..., 1) does", () => {
        expect(parseDelimiterFromHeader("v1; delim=aa_delim=bb")).toBe("aa_delim=bb");
    });

    it("returns null when there is no delimiter to find", () => {
        expect(parseDelimiterFromHeader("v1")).toBeNull();
        expect(parseDelimiterFromHeader("")).toBeNull();
    });
});

describe("payload", () => {
    it("is base64 Python's b64decode will accept", () => {
        expect(encodeSpans([mkSpan()])).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    });

    it("round-trips to a JSON array of loader-shaped spans", () => {
        const spans = JSON.parse(decodePayload(encodeSpans([mkSpan()])));
        expect(spans).toHaveLength(1);
        // The adapter's fix has to survive the codec: a string, not 1.
        expect(spans[0].kind).toBe("SpanKind.SERVER");
        expect(spans[0].context.trace_id).toBe("a".repeat(32));
        expect(spans[0].attributes["entity.1.name"]).toBe("math_agent");
    });

    it("encodes an empty list without blowing up", () => {
        expect(JSON.parse(decodePayload(encodeSpans([])))).toEqual([]);
    });
});

describe("trailer", () => {
    it("is exactly delimiter followed by payload", () => {
        const d = makeDelimiter();
        const trailer = buildTrailerBytes([mkSpan()], d);
        expect(trailer.subarray(0, d.length).toString("utf8")).toBe(d);
        expect(JSON.parse(decodePayload(trailer.subarray(d.length).toString("ascii")))).toHaveLength(1);
    });

    // The property the whole feature rests on: the caller's real response must
    // come back out of the wire bytes untouched.
    it("splits back out of a multibyte body byte-for-byte", () => {
        const d = makeDelimiter();
        const body = Buffer.from('{"answer":"héllo ✓"}', "utf8");
        const wire = Buffer.concat([body, buildTrailerBytes([mkSpan()], d)]);

        const { clean, payload } = splitBodyAndTrailer(wire, d);
        expect(clean.equals(body)).toBe(true);
        expect(JSON.parse(decodePayload(payload!))[0].kind).toBe("SpanKind.SERVER");
    });

    it("leaves an untrailered body alone", () => {
        const body = Buffer.from("plain response");
        const { clean, payload } = splitBodyAndTrailer(body, makeDelimiter());
        expect(clean.equals(body)).toBe(true);
        expect(payload).toBeNull();
    });
});

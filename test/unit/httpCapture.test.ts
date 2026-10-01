import { describe, it, expect } from "vitest";
import { gzipSync } from "zlib";
import {
    appendResponseChunk, getMethod, getParams, getRequestBody, getResponseBody,
    getRoute, getStatusCode, getUrl, rememberOriginalUrl, stringifyBody,
} from "../../src/instrumentation/http/capture";
import { MAX_STREAMING_CAPTURE_LENGTH } from "../../src/instrumentation/http/constants";

function fakeRes(headers: Record<string, string> = {}, statusCode = 200): any {
    return { statusCode, getHeader: (n: string) => headers[n.toLowerCase()] };
}

describe("route", () => {
    it("prefers the Express route template over the concrete path", () => {
        expect(getRoute({ url: "/users/12345?x=1", baseUrl: "", route: { path: "/users/:id" } }))
            .toBe("/users/:id");
    });

    it("joins baseUrl for a mounted router, matching monocle_apptrace", () => {
        expect(getRoute({ url: "/api/v1/ask?lang=en", baseUrl: "/api", route: { path: "/v1/ask" } }))
            .toBe("/api/v1/ask");
    });

    it("falls back to the path with the query stripped when no framework matched", () => {
        expect(getRoute({ url: "/users/12345?x=1" })).toBe("/users/12345");
    });

    // express.static and any other mounted middleware: no req.route, and req.url
    // has already lost the mount prefix by the time these accessors run.
    it("falls back to the original request target, not the rewritten req.url", () => {
        const req: any = { url: "/app.js", baseUrl: "/static" };
        rememberOriginalUrl(req, "/static/app.js");
        expect(getRoute(req)).toBe("/static/app.js");
    });
});

describe("url", () => {
    it("builds scheme, host and target including the query", () => {
        expect(getUrl({ url: "/api/v1/ask?lang=en", headers: { host: "127.0.0.1:8123" }, socket: {} }))
            .toBe("http://127.0.0.1:8123/api/v1/ask?lang=en");
    });

    it("uses https for a TLS socket", () => {
        expect(getUrl({ url: "/x", headers: { host: "h" }, socket: { encrypted: true } }))
            .toBe("https://h/x");
    });

    it("prefers x-forwarded-proto behind a proxy", () => {
        expect(getUrl({ url: "/x", headers: { host: "h", "x-forwarded-proto": "https,http" }, socket: {} }))
            .toBe("https://h/x");
    });

    // The header is client-controlled: without this it writes arbitrary text
    // into the scheme of entity.1.url.
    it("ignores an x-forwarded-proto that is neither http nor https", () => {
        expect(getUrl({
            url: "/x",
            headers: { host: "h", "x-forwarded-proto": "javascript:alert(1)" },
            socket: { encrypted: true },
        })).toBe("https://h/x");
    });

    it("keeps the mount prefix a router stripped from req.url", () => {
        const req: any = { url: "/v1/ask?lang=en", headers: { host: "h" }, socket: {} };
        rememberOriginalUrl(req, "/api/v1/ask?lang=en");
        expect(getUrl(req)).toBe("http://h/api/v1/ask?lang=en");
    });

    // Review Focus 5: a client that sends no Host header must not yield "http://undefined/x".
    it("falls back to localhost when there is no Host header", () => {
        expect(getUrl({ url: "/x", headers: {}, socket: {} })).toBe("http://localhost/x");
    });
});

describe("params", () => {
    it("returns the raw query string, unparsed", () => {
        expect(getParams({ url: "/ask?lang=en&verbose=true" })).toBe("lang=en&verbose=true");
    });

    // Review Focus 4: absent query must be falsy so processSpan omits the attribute.
    it("returns empty string when there is no query", () => {
        expect(getParams({ url: "/ask" })).toBe("");
    });
});

describe("request body", () => {
    it("serialises a parsed object body", () => {
        expect(getRequestBody({ body: { question: "What is Task Decomposition?" } }))
            .toBe('{"question":"What is Task Decomposition?"}');
    });

    it("passes a string body through", () => {
        expect(getRequestBody({ body: "raw text" })).toBe("raw text");
    });

    it("decodes a Buffer body", () => {
        expect(getRequestBody({ body: Buffer.from('{"a":1}') })).toBe('{"a":1}');
    });

    it("returns empty string when no body parser ran", () => {
        expect(getRequestBody({})).toBe("");
    });

    // Review Focus 3: a circular body must not throw out of the accessor.
    it("returns empty string for a circular body instead of throwing", () => {
        const body: any = { a: 1 };
        body.self = body;
        expect(getRequestBody({ body })).toBe("");
    });

    it("truncates to the limit", () => {
        expect(stringifyBody("x".repeat(5000), 1000)).toHaveLength(1000);
    });
});

describe("status code", () => {
    it("is a string, matching monocle_apptrace", () => {
        expect(getStatusCode(fakeRes({}, 200))).toBe("200");
    });

    it("is empty when the status is not set", () => {
        expect(getStatusCode({})).toBe("");
    });
});

describe("response body capture", () => {
    it("accumulates chunks in order", () => {
        const res = fakeRes({ "content-type": "application/json" });
        appendResponseChunk(res, '{"answer":');
        appendResponseChunk(res, '"42"}');
        expect(getResponseBody(res)).toBe('{"answer":"42"}');
    });

    it("captures when no content-type has been set yet", () => {
        const res = fakeRes();
        appendResponseChunk(res, "hello");
        expect(getResponseBody(res)).toBe("hello");
    });

    // Review Focus 1: a binary download must not be decoded into the span.
    it("captures nothing for a binary content-type", () => {
        const res = fakeRes({ "content-type": "image/png" });
        appendResponseChunk(res, Buffer.from([0xff, 0xd8, 0xff]));
        expect(getResponseBody(res)).toBe("");
    });

    // A compression middleware leaves content-type: application/json in place,
    // so without the content-encoding gate these gzip bytes become mojibake.
    it("captures nothing for a content-encoded response", () => {
        const res = fakeRes({ "content-type": "application/json", "content-encoding": "gzip" });
        appendResponseChunk(res, gzipSync(Buffer.from('{"answer":"42"}')));
        expect(getResponseBody(res)).toBe("");
    });

    it("still captures when the encoding is identity", () => {
        const res = fakeRes({ "content-type": "application/json", "content-encoding": "identity" });
        appendResponseChunk(res, '{"answer":"42"}');
        expect(getResponseBody(res)).toBe('{"answer":"42"}');
    });

    // Review Focus 2: the cap is cumulative across chunks, not per chunk.
    it("stops at the streaming cap across many chunks", () => {
        const res = fakeRes({ "content-type": "text/event-stream" });
        for (let i = 0; i < 1000; i++) appendResponseChunk(res, "x".repeat(100));
        expect(getResponseBody(res)).toHaveLength(MAX_STREAMING_CAPTURE_LENGTH);
    });

    it("returns empty string when nothing was written", () => {
        expect(getResponseBody(fakeRes())).toBe("");
    });
});

describe("method", () => {
    it("reads req.method", () => {
        expect(getMethod({ method: "POST" })).toBe("POST");
    });

    it("is empty when absent", () => {
        expect(getMethod({})).toBe("");
    });
});

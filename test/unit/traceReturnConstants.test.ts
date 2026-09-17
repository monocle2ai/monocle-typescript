import { describe, it, expect } from "vitest";
import * as C from "../../src/traceReturn/constants";

// Pinned against the Python side. If one of these changes, the TS server and the
// monocle_test_tools client stop understanding each other, and the symptom is a
// client that just sees no traces — not an error. Update only alongside Python.
describe("trace return wire constants", () => {
    it("matches monocle_apptrace constants.py exactly", () => {
        expect(C.MONOCLE_TRACE_RETURN_ENABLED_ENV).toBe("MONOCLE_ENABLE_TRACE_RETURN");
        expect(C.TRACE_RETURN_REQUEST_HEADER).toBe("x-monocle-retrieve-traces");
        expect(C.TRACE_RETURN_RESPONSE_HEADER).toBe("x-monocle-traces");
        expect(C.TRACE_RETURN_SCOPE_NAME).toBe("monocle_trace_return");
        expect(C.TRACE_RETURN_VERSION).toBe("v1");
        expect(C.MONOCLE_TRACE_RETRIEVAL_CALLBACK_ENV).toBe("MONOCLE_TRACE_RETRIEVAL_CALLBACK");
        expect(C.MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY_ENV).toBe("MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY");
    });

    it("derives the scope attribute the way spanHandler writes it", () => {
        expect(C.TRACE_RETURN_SCOPE_ATTRIBUTE).toBe("scope.monocle_trace_return");
    });

    it("matches trace_return.py's _DELIMITER_PREFIX", () => {
        expect(C.TRACE_RETURN_DELIMITER_PREFIX).toBe("__MONOCLE_TRACES__");
    });
});

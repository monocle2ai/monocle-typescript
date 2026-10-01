import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { context } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
    WORKFLOW_TYPE_HOLDER_KEY, createWorkflowTypeHolder, recordWorkflowType, resolveWorkflowType,
} from "../../src/instrumentation/common/workflowTypeHolder";
import { attachWorkflowType } from "../../src/instrumentation/common/spanHandler";

// attachWorkflowType reads context.active(); OTel's default no-op manager
// ignores context.with(), so install a real one for the suite.
beforeAll(() => {
    context.setGlobalContextManager(new AsyncHooksContextManager().enable());
});
afterAll(() => {
    context.disable();
});

describe("workflow type holder", () => {
    // The ESM and CJS builds have separate module state: the HTTP hook writes
    // this key and spanHandler reads it, so a plain Symbol() would silently
    // resolve every workflow span to the generic type.
    it("uses a cross-realm registered symbol as its context key", () => {
        expect(WORKFLOW_TYPE_HOLDER_KEY).toBe(Symbol.for("monocle.workflowTypeHolder"));
        expect(Symbol.keyFor(WORKFLOW_TYPE_HOLDER_KEY)).toBe("monocle.workflowTypeHolder");
    });

    it("defaults to workflow.generic when nothing wrote to it", () => {
        expect(resolveWorkflowType(createWorkflowTypeHolder())).toBe("workflow.generic");
    });

    it("defaults to workflow.generic when there is no holder at all", () => {
        expect(resolveWorkflowType(undefined)).toBe("workflow.generic");
    });

    it("records the first non-generic type and ignores later ones", () => {
        const holder = createWorkflowTypeHolder();
        recordWorkflowType(holder, "workflow.adk");
        recordWorkflowType(holder, "workflow.langchain");
        expect(resolveWorkflowType(holder)).toBe("workflow.adk");
    });

    it("ignores a generic type so a later framework can still win", () => {
        const holder = createWorkflowTypeHolder();
        recordWorkflowType(holder, "workflow.generic");
        recordWorkflowType(holder, "workflow.adk");
        expect(resolveWorkflowType(holder)).toBe("workflow.adk");
    });

    it("is filled by attachWorkflowType when a holder is in context", () => {
        const holder = createWorkflowTypeHolder();
        const ctx = context.active().setValue(WORKFLOW_TYPE_HOLDER_KEY, holder);
        context.with(ctx, () => {
            attachWorkflowType({ package: "@google/adk" } as any);
        });
        expect(resolveWorkflowType(holder)).toBe("workflow.adk");
    });

    it("leaves attachWorkflowType working when no holder is present", () => {
        expect(() => attachWorkflowType({ package: "@google/adk" } as any)).not.toThrow();
    });
});

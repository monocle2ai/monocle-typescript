import { describe, it, expect, afterEach } from "vitest";
import { isPathExcluded, resetExcludedPathsForTests } from "../../src/instrumentation/http/excludePaths";
import { getInstrumentor, setInstrumentor } from "../../src/instrumentation/common/utils";

// Mastra owns the whole /api namespace: custom routes registered through
// registerApiRoute() mount at the root with prefix "", so nothing a user
// writes can land here. That is what makes a keep-list safe - it can only
// ever swallow Mastra's own endpoints, never the application's.
//
// Both lists below are generated from @mastra/server's own createRoute()
// table, not sampled from traces. Sampling is what leaked /api/workspaces,
// /api/channels/platforms and /api/agents/<id>/threads/subscribe in turn.

const EXECUTION_ROUTES: readonly string[] = [
    "/api/agent-builder/x-actionid/observe",
    "/api/agent-builder/x-actionid/observe-stream-legacy",
    "/api/agent-builder/x-actionid/resume",
    "/api/agent-builder/x-actionid/resume-async",
    "/api/agent-builder/x-actionid/resume-no-wait",
    "/api/agent-builder/x-actionid/resume-stream",
    "/api/agent-builder/x-actionid/start",
    "/api/agent-builder/x-actionid/start-async",
    "/api/agent-builder/x-actionid/stream",
    "/api/agent-builder/x-actionid/stream-legacy",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/stream",
    "/api/agents/x-agentid/approve-network-tool-call",
    "/api/agents/x-agentid/approve-tool-call",
    "/api/agents/x-agentid/approve-tool-call-generate",
    "/api/agents/x-agentid/decline-network-tool-call",
    "/api/agents/x-agentid/decline-tool-call",
    "/api/agents/x-agentid/decline-tool-call-generate",
    "/api/agents/x-agentid/generate",
    "/api/agents/x-agentid/generate-legacy",
    "/api/agents/x-agentid/generate/vnext",
    "/api/agents/x-agentid/network",
    "/api/agents/x-agentid/observe",
    "/api/agents/x-agentid/queue-message",
    "/api/agents/x-agentid/resume-stream",
    "/api/agents/x-agentid/resume-stream-until-idle",
    "/api/agents/x-agentid/send-message",
    "/api/agents/x-agentid/send-tool-approval",
    "/api/agents/x-agentid/signals",
    "/api/agents/x-agentid/stream",
    "/api/agents/x-agentid/stream-legacy",
    "/api/agents/x-agentid/stream-until-idle",
    "/api/agents/x-agentid/stream/ui",
    "/api/agents/x-agentid/stream/vnext",
    "/api/agents/x-agentid/stream/vnext/ui",
    "/api/agents/x-agentid/streamVNext",
    "/api/agents/x-agentid/tools/x-toolid/execute",
    "/api/datasets/x-datasetid/generate-items",
    "/api/mcp/x-serverid/tools/x-toolid/execute",
    "/api/processors/x-processorid/execute",
    "/api/tools/x-toolid/execute",
    "/api/workflows/x-workflowid/observe",
    "/api/workflows/x-workflowid/observe-stream-legacy",
    "/api/workflows/x-workflowid/resume",
    "/api/workflows/x-workflowid/resume-async",
    "/api/workflows/x-workflowid/resume-no-wait",
    "/api/workflows/x-workflowid/resume-stream",
    "/api/workflows/x-workflowid/runs/x-runid/steps/execute",
    "/api/workflows/x-workflowid/start",
    "/api/workflows/x-workflowid/start-async",
    "/api/workflows/x-workflowid/stream",
    "/api/workflows/x-workflowid/stream-legacy",
    "/api/workflows/x-workflowid/time-travel-stream",
];

const MANAGEMENT_ROUTES: readonly string[] = [
    "/api/agent-builder",
    "/api/agent-builder/x-actionid",
    "/api/agent-builder/x-actionid/create-run",
    "/api/agent-builder/x-actionid/runs",
    "/api/agent-builder/x-actionid/runs/x-runid",
    "/api/agent-builder/x-actionid/runs/x-runid/cancel",
    "/api/agent-controller",
    "/api/agent-controller/x-controllerid/active-runs",
    "/api/agent-controller/x-controllerid/models",
    "/api/agent-controller/x-controllerid/modes",
    "/api/agent-controller/x-controllerid/sessions",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/abort",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/follow-up",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/goal",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/messages",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/mode",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/model",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/notifications",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/om",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/permissions",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/permissions/category",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/permissions/tool",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/resource",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/resources",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/state",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/steer",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/thread",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/threads",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/threads/clone",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/threads/x-threadid",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/threads/x-threadid/messages",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/tool-approval",
    "/api/agent-controller/x-controllerid/sessions/x-resourceid/tool-suspension",
    "/api/agent-controller/x-controllerid/workspace",
    "/api/agents",
    "/api/agents/providers",
    "/api/agents/x-agentid",
    "/api/agents/x-agentid/clone",
    "/api/agents/x-agentid/instructions/enhance",
    "/api/agents/x-agentid/model",
    "/api/agents/x-agentid/model/reset",
    "/api/agents/x-agentid/models/reorder",
    "/api/agents/x-agentid/models/x-modelconfigid",
    "/api/agents/x-agentid/plans/file",
    "/api/agents/x-agentid/recover",
    "/api/agents/x-agentid/skills/x-skillname",
    "/api/agents/x-agentid/suspended-runs",
    "/api/agents/x-agentid/threads/abort",
    "/api/agents/x-agentid/threads/signals/cancel",
    "/api/agents/x-agentid/threads/subscribe",
    "/api/agents/x-agentid/tools/x-toolid",
    "/api/auth/permission-patterns",
    "/api/auth/roles/x-roleid/permissions",
    "/api/datasets",
    "/api/datasets/cluster-failures",
    "/api/datasets/x-datasetid",
    "/api/datasets/x-datasetid/compare",
    "/api/datasets/x-datasetid/experiments",
    "/api/datasets/x-datasetid/experiments/x-experimentid",
    "/api/datasets/x-datasetid/experiments/x-experimentid/finalize",
    "/api/datasets/x-datasetid/experiments/x-experimentid/items/x-itemid/run",
    "/api/datasets/x-datasetid/experiments/x-experimentid/results",
    "/api/datasets/x-datasetid/experiments/x-experimentid/results/x-resultid",
    "/api/datasets/x-datasetid/items",
    "/api/datasets/x-datasetid/items/batch",
    "/api/datasets/x-datasetid/items/x-itemid",
    "/api/datasets/x-datasetid/items/x-itemid/history",
    "/api/datasets/x-datasetid/items/x-itemid/purge",
    "/api/datasets/x-datasetid/items/x-itemid/versions/x-datasetversion",
    "/api/datasets/x-datasetid/versions",
    "/api/embedders",
    "/api/experiments",
    "/api/experiments/review-summary",
    "/api/experiments/x-experimentid",
    "/api/logs",
    "/api/logs/transports",
    "/api/logs/x-runid",
    "/api/mcp/v0/servers",
    "/api/mcp/v0/servers/x-id",
    "/api/mcp/x-serverid/mcp",
    "/api/mcp/x-serverid/messages",
    "/api/mcp/x-serverid/resources",
    "/api/mcp/x-serverid/resources/read",
    "/api/mcp/x-serverid/sse",
    "/api/mcp/x-serverid/tools",
    "/api/mcp/x-serverid/tools/x-toolid",
    "/api/memory/config",
    "/api/memory/messages/delete",
    "/api/memory/network/messages/delete",
    "/api/memory/network/save-messages",
    "/api/memory/network/status",
    "/api/memory/network/threads",
    "/api/memory/network/threads/x-threadid",
    "/api/memory/network/threads/x-threadid/messages",
    "/api/memory/observational-memory",
    "/api/memory/observational-memory/buffer-status",
    "/api/memory/save-messages",
    "/api/memory/search",
    "/api/memory/status",
    "/api/memory/threads",
    "/api/memory/threads/x-threadid",
    "/api/memory/threads/x-threadid/clone",
    "/api/memory/threads/x-threadid/messages",
    "/api/memory/threads/x-threadid/transfer",
    "/api/memory/threads/x-threadid/working-memory",
    "/api/observability/branches",
    "/api/observability/traces",
    "/api/observability/traces/delete",
    "/api/observability/traces/light",
    "/api/observability/traces/score",
    "/api/observability/traces/x-traceid",
    "/api/observability/traces/x-traceid/branches/x-spanid",
    "/api/observability/traces/x-traceid/light",
    "/api/observability/traces/x-traceid/spans/x-spanid",
    "/api/observability/traces/x-traceid/trajectory",
    "/api/observability/traces/x-traceid/x-spanid/scores",
    "/api/processor-providers",
    "/api/processor-providers/x-providerid",
    "/api/processors",
    "/api/processors/x-processorid",
    "/api/scores",
    "/api/scores/entity/x-entitytype/x-entityid",
    "/api/scores/run/x-runid",
    "/api/scores/scorer/x-scorerid",
    "/api/scores/scorers",
    "/api/scores/scorers/x-scorerid",
    "/api/stored/agents",
    "/api/stored/agents/preview-instructions",
    "/api/stored/agents/x-agentid/versions",
    "/api/stored/agents/x-agentid/versions/compare",
    "/api/stored/agents/x-agentid/versions/x-versionid",
    "/api/stored/agents/x-agentid/versions/x-versionid/activate",
    "/api/stored/agents/x-agentid/versions/x-versionid/restore",
    "/api/stored/agents/x-storedagentid",
    "/api/stored/agents/x-storedagentid/change-request",
    "/api/stored/agents/x-storedagentid/dependents",
    "/api/stored/agents/x-storedagentid/export",
    "/api/stored/agents/x-storedagentid/favorite",
    "/api/stored/mcp-clients",
    "/api/stored/mcp-clients/x-mcpclientid/versions",
    "/api/stored/mcp-clients/x-mcpclientid/versions/compare",
    "/api/stored/mcp-clients/x-mcpclientid/versions/x-versionid",
    "/api/stored/mcp-clients/x-mcpclientid/versions/x-versionid/activate",
    "/api/stored/mcp-clients/x-mcpclientid/versions/x-versionid/restore",
    "/api/stored/mcp-clients/x-storedmcpclientid",
    "/api/stored/prompt-blocks",
    "/api/stored/prompt-blocks/x-promptblockid/versions",
    "/api/stored/prompt-blocks/x-promptblockid/versions/compare",
    "/api/stored/prompt-blocks/x-promptblockid/versions/x-versionid",
    "/api/stored/prompt-blocks/x-promptblockid/versions/x-versionid/activate",
    "/api/stored/prompt-blocks/x-promptblockid/versions/x-versionid/restore",
    "/api/stored/prompt-blocks/x-storedpromptblockid",
    "/api/stored/scorers",
    "/api/stored/scorers/x-scorerid/versions",
    "/api/stored/scorers/x-scorerid/versions/compare",
    "/api/stored/scorers/x-scorerid/versions/x-versionid",
    "/api/stored/scorers/x-scorerid/versions/x-versionid/activate",
    "/api/stored/scorers/x-scorerid/versions/x-versionid/restore",
    "/api/stored/scorers/x-storedscorerid",
    "/api/stored/skills",
    "/api/stored/skills/x-storedskillid",
    "/api/stored/skills/x-storedskillid/favorite",
    "/api/stored/skills/x-storedskillid/publish",
    "/api/stored/workspaces",
    "/api/stored/workspaces/x-storedworkspaceid",
    "/api/system/api-schema",
    "/api/system/packages",
    "/api/tool-providers",
    "/api/tool-providers/x-providerid/auth-status/x-authid",
    "/api/tool-providers/x-providerid/authorize",
    "/api/tool-providers/x-providerid/connection-fields",
    "/api/tool-providers/x-providerid/connection-status",
    "/api/tool-providers/x-providerid/connections",
    "/api/tool-providers/x-providerid/connections/x-connectionid",
    "/api/tool-providers/x-providerid/connections/x-connectionid/usage",
    "/api/tool-providers/x-providerid/health",
    "/api/tool-providers/x-providerid/toolkits",
    "/api/tool-providers/x-providerid/tools",
    "/api/tool-providers/x-providerid/tools/x-toolslug/schema",
    "/api/tools",
    "/api/tools/x-toolid",
    "/api/v1/conversations",
    "/api/v1/conversations/x-conversationid",
    "/api/v1/conversations/x-conversationid/items",
    "/api/v1/responses",
    "/api/v1/responses/x-responseid",
    "/api/vector/x-vectorname/create-index",
    "/api/vector/x-vectorname/indexes",
    "/api/vector/x-vectorname/indexes/x-indexname",
    "/api/vector/x-vectorname/query",
    "/api/vector/x-vectorname/upsert",
    "/api/vectors",
    "/api/workflows",
    "/api/workflows/events",
    "/api/workflows/run-counts",
    "/api/workflows/x-workflowid",
    "/api/workflows/x-workflowid/create-run",
    "/api/workflows/x-workflowid/restart",
    "/api/workflows/x-workflowid/restart-all-active-workflow-runs",
    "/api/workflows/x-workflowid/restart-all-active-workflow-runs-async",
    "/api/workflows/x-workflowid/restart-async",
    "/api/workflows/x-workflowid/runs",
    "/api/workflows/x-workflowid/runs/x-runid",
    "/api/workflows/x-workflowid/runs/x-runid/cancel",
    "/api/workflows/x-workflowid/time-travel",
    "/api/workflows/x-workflowid/time-travel-async",
    "/api/workspaces",
    "/api/workspaces/x-workspaceid",
    "/api/workspaces/x-workspaceid/fs/delete",
    "/api/workspaces/x-workspaceid/fs/list",
    "/api/workspaces/x-workspaceid/fs/mkdir",
    "/api/workspaces/x-workspaceid/fs/read",
    "/api/workspaces/x-workspaceid/fs/stat",
    "/api/workspaces/x-workspaceid/fs/write",
    "/api/workspaces/x-workspaceid/index",
    "/api/workspaces/x-workspaceid/search",
    "/api/workspaces/x-workspaceid/skills",
    "/api/workspaces/x-workspaceid/skills-sh/install",
    "/api/workspaces/x-workspaceid/skills-sh/popular",
    "/api/workspaces/x-workspaceid/skills-sh/preview",
    "/api/workspaces/x-workspaceid/skills-sh/remove",
    "/api/workspaces/x-workspaceid/skills-sh/search",
    "/api/workspaces/x-workspaceid/skills-sh/update",
    "/api/workspaces/x-workspaceid/skills/search",
    "/api/workspaces/x-workspaceid/skills/x-skillname",
    "/api/workspaces/x-workspaceid/skills/x-skillname/references",
    "/api/workspaces/x-workspaceid/skills/x-skillname/references/x-referencepath",
];

function withMastra(fn: () => void) {
    const previous = getInstrumentor();
    setInstrumentor({ hookedPackages: new Set(["@mastra/core"]) });
    resetExcludedPathsForTests();
    try { fn(); } finally {
        setInstrumentor(previous);
        resetExcludedPathsForTests();
    }
}

afterEach(() => resetExcludedPathsForTests());

describe("Mastra keep-list", () => {
    // The failure that matters. A missed entry here silently loses a real
    // agent trace, which is far worse than letting a noisy span through.
    it("traces every execution route Mastra declares", () => {
        withMastra(() => {
            const lost = EXECUTION_ROUTES.filter((r) => isPathExcluded(r, "POST"));
            expect(lost).toEqual([]);
        });
    });

    it("excludes the management surface", () => {
        withMastra(() => {
            const kept = MANAGEMENT_ROUTES.filter((r) => !isPathExcluded(r, "POST"));
            // start-async and observe-stream-legacy are execution routes that
            // read as management by name; keeping them is correct.
            expect(kept.every((r) => /start-async|observe-stream/.test(r))).toBe(true);
        });
    });

    it("excludes the three routes that leaked from trace sampling", () => {
        withMastra(() => {
            expect(isPathExcluded("/api/workspaces", "GET")).toBe(true);
            expect(isPathExcluded("/api/channels/platforms", "GET")).toBe(true);
            expect(isPathExcluded("/api/agents/weather-agent/threads/subscribe", "POST")).toBe(true);
        });
    });

    it("leaves the application's own routes alone, since they mount at the root", () => {
        withMastra(() => {
            expect(isPathExcluded("/my-custom-route", "GET")).toBe(false);
            expect(isPathExcluded("/webhooks/stripe", "POST")).toBe(false);
        });
    });
});

// The keep-list is a built-in default. MONOCLE_HTTP_EXCLUDE_PATHS is explicit
// user intent, and the only lever for keeping an endpoint's body out of an
// exporter, since bodies are captured unredacted. A default that overrode it
// would silently export the one route the user asked to protect.
describe("Mastra keep-list — the user's exclude list outranks it", () => {
    function withEnv(value: string, fn: () => void) {
        const previous = process.env.MONOCLE_HTTP_EXCLUDE_PATHS;
        process.env.MONOCLE_HTTP_EXCLUDE_PATHS = value;
        resetExcludedPathsForTests();
        try { fn(); } finally {
            if (previous === undefined) delete process.env.MONOCLE_HTTP_EXCLUDE_PATHS;
            else process.env.MONOCLE_HTTP_EXCLUDE_PATHS = previous;
            resetExcludedPathsForTests();
        }
    }

    it("excludes a kept execution route the user listed", () => {
        withEnv("/api/agents/secret-agent", () => {
            withMastra(() => {
                process.env.MONOCLE_HTTP_EXCLUDE_PATHS = "/api/agents/secret-agent";
                resetExcludedPathsForTests();
                expect(isPathExcluded("/api/agents/secret-agent/send-message", "POST")).toBe(true);
            });
        });
    });

    it("still keeps execution routes the user did not list", () => {
        withEnv("/api/agents/secret-agent", () => {
            withMastra(() => {
                process.env.MONOCLE_HTTP_EXCLUDE_PATHS = "/api/agents/secret-agent";
                resetExcludedPathsForTests();
                expect(isPathExcluded("/api/agents/public-agent/send-message", "POST")).toBe(false);
            });
        });
    });
});

import { MethodConfig } from "../../common/constants";
import { AGENT_REQUEST } from "./entities/agentRequest";
import { OpenAIAgentsSpanHandler } from "./agentsProcessor";

// @openai/agents only re-exports from -core, so hooking core covers both
// specifiers: the Runner class is shared, and patching its prototype reaches
// every holder.
const AGENTS_PACKAGE = "@openai/agents-core";

// Runner.run is the only patchable seam: the run loop's per-agent steps are ES
// private fields. Invocation and tool spans come from the SDK's RunHooks
// lifecycle events instead — see agentsHookBridge.
export const config: MethodConfig[] = [
    {
        package: AGENTS_PACKAGE,
        object: "Runner",
        method: "run",
        spanName: "openai_agents.runner.run",
        spanHandler: new OpenAIAgentsSpanHandler(),
        output_processor: [AGENT_REQUEST],
    } as unknown as MethodConfig,
];

import { MethodConfig } from "../../common/constants";
import { AGENT, AGENT_DELEGATION, AGENT_REQUEST } from "./entities/inference";
import { TOOL } from "./entities/tools";
import { ADKAgentSpanHandler, ADKRunnerSpanHandler, ADKToolSpanHandler } from "./adkProcessor";

const ADK_PACKAGE = "@google/adk";

// All classes hooked here are re-exported from the top-level `@google/adk`
// entry point, so a single package matcher catches both ESM and CJS users.
// Wrapping the base classes (`BaseAgent`, `Runner`) propagates through the
// prototype chain to every concrete subclass (`LlmAgent`, `LoopAgent`,
// `SequentialAgent`, `InMemoryRunner`, etc.).
export const config: MethodConfig[] = [
    {
        package: ADK_PACKAGE,
        object: "Runner",
        method: "runAsync",
        spanName: "adk.runner.run_async",
        spanHandler: new ADKRunnerSpanHandler(),
        output_processor: [AGENT_REQUEST],
    } as unknown as MethodConfig,
    {
        package: ADK_PACKAGE,
        object: "Runner",
        method: "runEphemeral",
        spanName: "adk.runner.run_ephemeral",
        spanHandler: new ADKRunnerSpanHandler(),
        output_processor: [AGENT_REQUEST],
    } as unknown as MethodConfig,
    {
        package: ADK_PACKAGE,
        object: "BaseAgent",
        method: "runAsync",
        spanName: "adk.agent.run",
        spanHandler: new ADKAgentSpanHandler(),
        output_processor: [AGENT],
    } as unknown as MethodConfig,
    {
        package: ADK_PACKAGE,
        object: "FunctionTool",
        method: "runAsync",
        spanName: "adk.tool",
        spanHandler: new ADKToolSpanHandler(),
        output_processor: [TOOL],
    } as unknown as MethodConfig,
    {
        package: ADK_PACKAGE,
        object: "AgentTool",
        method: "runAsync",
        spanName: "adk.agent_as_tool",
        spanHandler: new ADKToolSpanHandler(),
        output_processor: [AGENT_DELEGATION],
    } as unknown as MethodConfig,
];

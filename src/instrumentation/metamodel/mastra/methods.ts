import { MethodConfig } from "../../common/constants";
import { DefaultSpanHandler } from "../../common/spanHandler";
import { AGENT_REQUEST } from "./entities/agentRequest";
import { AGENT_INVOCATION } from "./entities/agentInvocation";
import { INFERENCE, INFERENCE_STREAM } from "./entities/inference";
import { MastraInvocationSpanHandler, MastraTurnSpanHandler, mastraToolWrapper } from "./mastraProcessor";

// Agent.generate() (one-shot) and Agent.stream() (streaming) are exported
// prototype methods on the singleton Agent class; @mastra/core/agent is the
// only specifier that exports Agent (the package root exports only Mastra).
// Patching here covers direct app usage AND Mastra's internally-created agents.
// Each call is one agentic turn.
const MASTRA_AGENT_PACKAGE = "@mastra/core/agent";

// Mastra normalizes every model (router strings AND raw AI-SDK objects) into an
// AI-SDK LanguageModelV2 wrapper. ModelRouterLanguageModel (exported from
// @mastra/core/llm) is the single choke point: generate()/stream() → the agentic
// loop → model.doGenerate()/doStream(). One wrap per method = one inference span
// per LLM call, for every provider (read off modelId / provider).
const MASTRA_LLM_PACKAGE = "@mastra/core/llm";

export const config: MethodConfig[] = [
    {
        package: MASTRA_AGENT_PACKAGE,
        object: "Agent",
        method: "generate",
        spanName: "mastra.agent.generate",
        spanHandler: new MastraTurnSpanHandler(),
        output_processor: [AGENT_REQUEST],
    } as unknown as MethodConfig,
    {
        package: MASTRA_AGENT_PACKAGE,
        object: "Agent",
        method: "stream",
        spanName: "mastra.agent.stream",
        spanHandler: new MastraTurnSpanHandler(),
        output_processor: [AGENT_REQUEST],
    } as unknown as MethodConfig,
    // Same package/object/method as the turn entries above, so each pair is
    // merged into one nested chain: turn outside, invocation inside. Must stay
    // after the turn entries — order decides the nesting.
    {
        package: MASTRA_AGENT_PACKAGE,
        object: "Agent",
        method: "generate",
        spanName: "mastra.agent.invoke",
        spanHandler: new MastraInvocationSpanHandler(),
        output_processor: [AGENT_INVOCATION],
    } as unknown as MethodConfig,
    {
        package: MASTRA_AGENT_PACKAGE,
        object: "Agent",
        method: "stream",
        spanName: "mastra.agent.invoke",
        spanHandler: new MastraInvocationSpanHandler(),
        output_processor: [AGENT_INVOCATION],
    } as unknown as MethodConfig,
    {
        // DefaultSpanHandler: used when the span is not part of a larger agentic turn (e.g. when the LLM is called directly, outside of an agentic loop). This ensures that the span is still created and processed correctly, even if it is not part of a larger agentic turn.
        // (NOT NonFrameworkSpanHandler): used when the span is part of a larger agentic turn (e.g. when the LLM is called from within an agentic loop). This ensures that the span is created and processed correctly, and that it is linked to the parent span of the agentic turn.
        // here our span is part of a larger agentic turn but mastra doesn't emit any inference spans for the LLM call, so we use DefaultSpanHandler to ensure that the span is still created and processed correctly.
        
        package: MASTRA_LLM_PACKAGE,
        object: "ModelRouterLanguageModel",
        method: "doGenerate",
        spanName: "mastra.model.generate",
        spanHandler: new DefaultSpanHandler(),
        output_processor: [INFERENCE],
    } as unknown as MethodConfig,
    {
        // Streaming counterpart (agent.stream()): INFERENCE_STREAM's
        // response_processor observes the returned stream and defers the span
        // until it closes. See entities/inference.ts.
        package: MASTRA_LLM_PACKAGE,
        object: "ModelRouterLanguageModel",
        method: "doStream",
        spanName: "mastra.model.stream",
        spanHandler: new DefaultSpanHandler(),
        output_processor: [INFERENCE_STREAM],
    } as unknown as MethodConfig,
    {
        // Tools have no patchable method — createTool() returns a plain object
        // whose execute is a per-instance closure — so mastraToolWrapper wraps
        // each execute in the tool map convertTools assembles instead.
        // Not getToolsForExecution: it only delegates here, and just the
        // agent-as-tool path calls it, so patching it traced nothing.
        // This call emits no span itself; the tool spans carry the metadata.
        package: MASTRA_AGENT_PACKAGE,
        object: "Agent",
        method: "convertTools",
        wrapperMethod: mastraToolWrapper,
    } as unknown as MethodConfig,
];

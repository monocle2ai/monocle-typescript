import { config as langchainPackages } from "../metamodel/langchain/methods";
import { config as llamaindexPackages } from "../metamodel/llamaindex/methods";
import { config as openaiPackages } from "../metamodel/openai/methods";
import { config as teamsaiPackages } from "../metamodel/teamsai/methods";
import { config as sageMakerPackages } from "../metamodel/sagemaker/methods";
import { config as bedrockPackages } from "../metamodel/bedrock/methods";
import { config as openSearchPackages } from "../metamodel/opensearch/methods";
import { config as vercelAiPackages } from "../metamodel/vercelAI/methods";
import { config as anthropicPackages } from "../metamodel/anthropic/methods";
import { config as geminiPackages } from "../metamodel/gemini/methods";
// import { config as langgraphPackages } from "../metamodel/langgraph/methods";
import { config as mcpPackages } from "../metamodel/mcp/methods";
import { config as a2aPackages } from "../metamodel/a2a/methods";
import { config as openaiAgentsPackages } from "../metamodel/agents/methods";
import { config as adkPackages } from "../metamodel/adk/methods";
import { config as mastraPackages } from "../metamodel/mastra/methods";
import { MethodConfig } from "./constants";

export const combinedPackages: MethodConfig[] = [
  ...langchainPackages,
  ...llamaindexPackages,
  ...openaiPackages,
  ...sageMakerPackages,
  ...bedrockPackages,
  ...openSearchPackages,
  ...vercelAiPackages,
  ...teamsaiPackages,
  ...anthropicPackages,
  ...geminiPackages,
  // ...langgraphPackages,
  ...mcpPackages,
  ...a2aPackages,
  ...openaiAgentsPackages,
  ...adkPackages,
  ...mastraPackages
];

// Bare package name from a possibly-subpath specifier.
// "@mastra/core/agent" -> "@mastra/core"; "openai/resources/..." -> "openai".
export function getBarePackageName(spec: string): string {
  if (spec.startsWith("@")) {
    return spec.split("/").slice(0, 2).join("/");
  }
  return spec.split("/")[0];
}

// Bare package names Monocle instruments, derived from the enabled metamodels.
// Single runtime source of truth for the hook audit and the withMonocle sync test.
export function getInstrumentedPackageNames(): string[] {
  return Array.from(
    new Set(
      combinedPackages
        .map((p) => (p as any).package)
        .filter((pkg: unknown): pkg is string => typeof pkg === "string")
        .map(getBarePackageName)
    )
  );
}

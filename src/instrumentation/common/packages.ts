import { config as langchainPackages } from "../metamodel/langchain/methods";
import { config as llamaindexPackages } from "../metamodel/llamaindex/methods";
import { config as openaiPackages } from "../metamodel/openai/methods";
import { config as teamsaiPackages } from "../metamodel/teamsai/methods";
import { config as sageMakerPackages } from "../metamodel/sagemaker/methods";
import { config as bedrockPackages } from "../metamodel/bedrock/methods";
import { config as openSearchPackages } from "../metamodel/opensearch/methods";
import { config as vercelAiPackages } from "../metamodel/vercelAI/methods";
import { config as anthropicPackages } from "../metamodel/anthropic/methods";

export interface MethodConfig {
  package: string;
  object: string;
  method: string;
  spanName?: string;
  spanType?: string;
  output_processor?: any[];
}

export const combinedPackages: MethodConfig[] = [
  ...langchainPackages,
  ...llamaindexPackages,
  ...openaiPackages,
  ...sageMakerPackages,
  ...bedrockPackages,
  ...openSearchPackages,
  ...vercelAiPackages,
  ...teamsaiPackages,
  ...anthropicPackages

];

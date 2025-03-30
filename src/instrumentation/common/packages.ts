import { config as langchainPackages } from "../metamodel/langchain/methods";
import { config as llamaindexPackages } from "../metamodel/llamaindex/methods";
// import {config as expressPackages} from "../metamodel/express/methods";
import { config as openaiPackages } from "../metamodel/openai/methods";
import { config as sageMakerPackages } from "../metamodel/sagemaker/methods";
import { config as bedrockPackages } from "../metamodel/bedrock/methods";
import { config as openSearchPackages } from "../metamodel/opensearch/methods";

export const combinedPackages = [
  ...langchainPackages,
  ...llamaindexPackages,
  // ...expressPackages
  ...openaiPackages,
  ...sageMakerPackages,
  ...bedrockPackages,
  ...openSearchPackages
];

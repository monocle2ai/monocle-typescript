import { config as langchainPackages } from "../metamodel/langchain/methods";
import { config as llamaindexPackages } from "../metamodel/llamaindex/methods";
// import {config as expressPackages} from "../metamodel/express/methods";
import { config as openaiPackages } from "../metamodel/openai/methods";
import { config as teamsaiPackages } from "../metamodel/teamsai/methods";

export const combinedPackages = [
  ...langchainPackages,
  ...llamaindexPackages,
  // ...expressPackages
  ...openaiPackages,
  ...teamsaiPackages
];
// import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { config as teamsOutputConfig } from "./entities/teamsOutputProcessor.js";
import { config as actionPlannerConfig } from "./entities/actionPlannerOutputProcessor.js";

export const config = [
  {
    package: "@microsoft/teams-ai/lib/models/OpenAIModel",
    object: "OpenAIModel",
    method: "completePrompt",
    spanName: "teamsai.openai.completePrompt",
    output_processor: [teamsOutputConfig]
  },
  {
    package: "@microsoft/teams-ai",
    object: "ActionPlanner",
    method: "completePrompt",
    spanName: "teamsai.actionPlanner.completePrompt",
    spanType: "workflow",
    output_processor: [
      actionPlannerConfig
    ]
  }
];

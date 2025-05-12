// import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { config as teamsOutputConfig } from "./entities/teamsOutputProcessor";
import { config as actionPlannerConfig } from "./entities/actionPlannerOutputProcessor";

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
    output_processor: [
      actionPlannerConfig
    ]
  }
];

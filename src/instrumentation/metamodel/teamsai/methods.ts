// import { NonFrameworkSpanHandler } from "../../common/spanHandler";

export const config = [
  {
    package: "@microsoft/teams-ai/lib/models/OpenAIModel",
    object: "OpenAIModel",
    method: "completePrompt",
    spanName: "teamsai.openai.completePrompt",
    output_processor: [require("./entities/teamsOutputProcessor.js").config]
  },
  {
    package: "@microsoft/teams-ai",
    object: "ActionPlanner",
    method: "completePrompt",
    spanName: "teamsai.actionPlanner.completePrompt",
    spanType: "workflow",
    output_processor: [
      require("./entities/actionPlannerOutputProcessor.js").config
    ]
  }
];

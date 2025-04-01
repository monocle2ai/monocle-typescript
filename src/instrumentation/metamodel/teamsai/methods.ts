// import { NonFrameworkSpanHandler } from "../../common/spanHandler";

export const config = [
  {
    package: "@microsoft/teams-ai/lib/models/OpenAIModel",
    object: "OpenAIModel",
    method: "completePrompt",
    spanName: "teamsai.workflow",
    output_processor: [require("./entities/teamsOutputProcessor.js").config]
    // spanHandler: new NonFrameworkSpanHandler()
  },
  {
    package: require.resolve("@microsoft/teams-ai"),
    object: "ActionPlanner",
    method: "completePrompt",
    spanName: "teamsai.workflow",
    output_processor: [
      require("./entities/actionPlannerOutputProcessor.js").config
    ]
    // spanHandler: new NonFrameworkSpanHandler()
  }
];

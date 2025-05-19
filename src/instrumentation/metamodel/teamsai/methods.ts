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
  },
  {
    package: "@microsoft/teams-ai",
    object: "ActionPlanner",
    method: "beginTask",
    scopeName: "teams.conversation_id",
    scopeValues: function ({ currentArgs, element }) {

      const scopes: Record<string, string> = {};
      const context = currentArgs[0];
      if (context && context.activity && context.activity.conversation.id && element) {
        const conversation_id = context.activity.conversation.id || "";
        const user_aad_object_id = context.activity.from.aadObjectId || "";
        const user_teams_id = context.activity.from.id || "";
        const channel_id = context.activity.channelId || "";
        const recipient_id = context.activity.recipient.id || "";
        const recipient_aad_object_id = context.activity.recipient.aadObjectId || "";
        scopes["teams.conversation.conversation.id"] = conversation_id;
        scopes["teams.user.from_property.aad_object_id"] = user_aad_object_id;
        scopes["teams.user.from_property.id"] = user_teams_id;
        scopes["teams.channel.channel_id"] = channel_id;
        scopes["teams.channel.recipient.id"] = recipient_id;
        scopes["teams.channel.recipient.aad_object_id"] = recipient_aad_object_id;
      }
      return scopes
    },
  }
];

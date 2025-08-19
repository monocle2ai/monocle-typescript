import { AGENT_PREFIX_KEY, INFERENCE_AGENT_DELEGATION, INFERENCE_COMMUNICATION, INFERENCE_TOOL_CALL } from "../../../common/constants";
import { mapLangchainFinishReasonToFinishType } from "../../finishType";
import {
  extractAssistantMessage,
  getExceptionMessage,
  getLlmMetadata,
  getStatus,
  getStatusCode,
} from "../../utils";
import { context } from "@opentelemetry/api";


function extractFinishReason(args){
  try {
      if (
        args?.response_metadata?.finish_reason
      ) {
        return args.response_metadata.finish_reason;
      }
    } catch (e) {
      console.warn(
        "Warning: Error occurred in extract_finish_reason:",
        e
      );
      return "";
    }
    return "";
}

export const config = {
  type: "inference",
  attributes: [
    [
      {
        _comment: "provider type ,name , deployment , inference_endpoint",
        attribute: "type",
        accessor: function ({ instance }) {
          if (
            instance?.constructor?.name
              ?.toLowerCase()
              .includes("azurechatopenai")
          ) {
            return "inference.azure_openai";
          }
          if (
            instance?.constructor?.name?.toLowerCase().includes("chatopenai")
          ) {
            return "inference.openai";
          }
          return "";
        },
      },
      {
        attribute: "deployment",
        accessor: function ({ instance }) {
          return (
            instance.engine ||
            instance.deployment ||
            instance.deployment_name ||
            instance.deployment_id ||
            instance.azure_deployment
          );
        },
      },
      {
        attribute: "inference_endpoint",
        accessor: function ({ instance }) {
          return (
            instance.azure_endpoint ||
            instance.api_base ||
            instance?.client?.baseURL
          );
        },
      },
      {
        attribute: "provider_name",
        accessor: function ({ instance }) {
          return instance.provider_name || "unknown_provider";
        },
      },
    ],
    [
      {
        _comment: "LLM Model",
        attribute: "name",
        accessor: function ({ instance }) {
          return instance.model_name || instance.model;
        },
      },
      {
        attribute: "type",
        accessor: function ({ instance }) {
          return "model.llm." + (instance.model_name || instance.model);
        },
      },
    ],
  ],
  events: [
    {
      name: "data.input",
      attributes: [
        {
          _comment: "this is instruction to LLM",
          attribute: "input",
          accessor: function ({
            args,
            // instance
          }) {
            return [args[0].value || args[0] || ""];
          },
        },
      ],
    },
    {
      name: "data.output",
      attributes: [
        {
          "_comment": "this is response from LLM",
          "attribute": "response",
          "accessor": function ({ response, exception }) {
            if (exception) {
              return getExceptionMessage({ exception });
            }
            return [extractAssistantMessage(response)];
          },
        },
        {
          "attribute": "status",
          "accessor": (args) => {
            return getStatus(args);
          },
        },
        {
          "attribute": "status_code",
          "accessor": (args) => {
            return getStatusCode(args);
          },
        },
      ],
    },
    {
      name: "metadata",
      attributes: [
        {
          "_comment": "this is response metadata from LLM",
          "accessor": function ({ instance, response }) {
            return getLlmMetadata({ response, instance });
          },
        },
        {
          "_comment": "finish reason from LLM response",
          "attribute": "finish_reason",
          "accessor": function({args}) {
            return extractFinishReason(args);
          }
        },
        {
            "_comment": "finish type mapped from finish reason",
            "attribute": "finish_type",
            "accessor": function ({ response }) {
                const finishReason = extractFinishReason(response);
                return mapLangchainFinishReasonToFinishType(finishReason);
            }
        },
        {
          "attribute": "inference_sub_type",
          "accessor": function ({ args }) {
            try {
                const agentPrefix = context.active().getValue(AGENT_PREFIX_KEY);
                if (agentPrefix) {
                    if (args.result && 'tool_calls' in args.result && args.result.tool_calls) {
                        const toolCall = args.result.tool_calls.length > 0 ? args.result.tool_calls[0] : null;
                        if (toolCall && 'name' in toolCall && toolCall.name.startsWith(agentPrefix)) {
                            return INFERENCE_AGENT_DELEGATION;
                        } else {
                            return INFERENCE_TOOL_CALL;
                    }
                }
                }
                return INFERENCE_COMMUNICATION;
            } catch (e) {
                console.warn("Warning: Error occurred in agent_inference_type:", e);
                return null;
            }
          },
        },
      ],
    },
  ],
};

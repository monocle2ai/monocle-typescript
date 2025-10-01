import { AGENT_PREFIX_KEY, INFERENCE_AGENT_DELEGATION, INFERENCE_COMMUNICATION, INFERENCE_TOOL_CALL, SPAN_TYPES } from "../../../common/constants";
import { mapLangchainFinishReasonToFinishType } from "../../finishType";
import {
  extractAssistantMessage,
  getExceptionMessage,
  getLlmMetadata,
  getStatus,
  getStatusCode,
} from "../../utils";
import { context } from "@opentelemetry/api";


function extractInputMessages(args) {
  // Extract system and user messages
  try {
    const messages = [];
    if (args && args[0] && typeof args[0].text === 'string') {
      return [args[0].text];
    }
    if (args && args[0] && typeof args[0] === 'string') {
      return [args[0]];
    }
    if (args && args.length > 0) {

      for (const msg of args[0]) {
        if (msg && typeof msg.content === 'string' && msg.constructor.name) {
          messages.push({ [msg.constructor.name]: msg.content });
        }
      }

    }
    return messages.map(d => JSON.stringify(d));
  } catch (e) {
    return [];
  }
}

function extractOutputResponse(response) {
  try {
    if (response && response.tool_calls && response.tool_calls.length > 0) {
      const toolCall = response.tool_calls[0];
      if (toolCall.function) {
        return `${toolCall.function.name}: (${toolCall.function.arguments})`;
      } else if (toolCall.name) {
        return `${toolCall.name}`;
      }
    }
    return JSON.stringify(response);
  } catch (e) {
    console.warn(
      "Warning: Error occurred in extract_output_response:",
      e
    );
  }
  return "";
}

function extractFinishReason(args) {
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
  "type": SPAN_TYPES.INFERENCE_FRAMEWORK,
  "attributes": [
    [
      {
        "_comment": "provider type ,name , deployment , inference_endpoint",
        "attribute": "type",
        "accessor": function ({ instance }) {
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
        "attribute": "deployment",
        "accessor": function ({ instance }) {
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
        "attribute": "inference_endpoint",
        "accessor": function ({ instance }) {
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
          }) {
            return extractInputMessages(args);
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
            const result = extractAssistantMessage(response)
            if (result.length > 0) {
              return JSON.stringify(result);
            }
            else {
              return extractOutputResponse(response);
            }
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
          "accessor": function ({ args }) {
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
          "accessor": function ({ response }) {
            try {
              let currentContext = context.active();
              const agentPrefix = currentContext.getValue(AGENT_PREFIX_KEY);
              if (agentPrefix) {
                const prefixString = typeof agentPrefix === 'symbol' ? agentPrefix.description : agentPrefix;
                if (response && 'tool_calls' in response && response.tool_calls) {
                  const toolCall = response.tool_calls.length > 0 ? response.tool_calls[0] : null;
                  if (toolCall && 'name' in toolCall && prefixString && toolCall.name.startsWith(prefixString)) {
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

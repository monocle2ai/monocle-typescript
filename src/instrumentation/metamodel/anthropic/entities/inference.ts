import { detectSdkType, extractInferenceEndpoint } from "../../../common/utils";
import { extractAssistantMessage, getExceptionMessage, getLlmMetadata, getStatus, getStatusCode } from "../../utils";
import { context } from '@opentelemetry/api';
const AGENT_PREFIX_KEY = Symbol("monocle.agent.prefix")

const INFERENCE_AGENT_DELEGATION = "delegation"
const INFERENCE_TOOL_CALL = "tool_call"
const INFERENCE_COMMUNICATION = "turn"

export const config = {
  "type": "inference",
  "attributes": [
    [
      {
        "_comment": "provider type, name, deployment, inference_endpoint",
        "attribute": "type",
        "accessor": function ({instance}) {
          return detectSdkType(instance);
        }
      },
      {
        "attribute": "inference_endpoint",
        "accessor": function ({ instance }) {
          return extractInferenceEndpoint(instance) || "unknown_endpoint";
        }
      },
      {
        "attribute": "deployment",
        "accessor": function ({ instance }) {
          return instance.engine || instance.deployment || instance.deployment_name || instance.deployment_id || instance.azure_deployment
        }
      },
      {
        "attribute": "provider_name",
        "accessor": function ({ instance }) {
          return instance.provider_name || "unknown_provider";
        }
      },
    ],
    [
      {
        "_comment": "LLM Model",
        "attribute": "name",
        "accessor": function ({ args }) {
          return args[0]?.model || "unknown_model";
        }
      },
      {
        "attribute": "type",
        "accessor": function ({ args }) {
          const modelName = args[0]?.model || "unknown_model";
          return "model.llm." + modelName;
        }
      }
    ]
  ],
  "events": [
    {
      "name": "data.input",
      "attributes": [

        {
          "_comment": "this is instruction to LLM",
          "attribute": "input",
          "accessor": function ({ args }) {
            if (args[0]?.messages && Array.isArray(args[0].messages)) {
              return args[0].messages
                .filter(msg => msg.role === "user")
                .map(msg => msg.content);
            }
            return ["unknown_input"];
          }
        }
      ]
    },
    {
      "name": "data.output",
      "attributes": [
        {
          "_comment": "this is response from LLM",
          "attribute": "response",
          "accessor": function ({ response, exception }) {
            // Handle exception case
            if (exception) {
              return getExceptionMessage({ exception });
            }
            // Handle Anthropic's response format
            if (response?.content) {
              if (Array.isArray(response.content)) {
                // Extract text from content array
                return response.content
                  .filter(item => item.type === 'text')
                  .map(item => item.text);
              } else if (typeof response.content === 'string') {
                return [response.content];
              }
            }
            // Fallback to extractAssistantMessage for compatibility
            return [extractAssistantMessage(response) || "unknown_response"];
          }
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
      ]
    },
    {
      "name": "metadata",
      "attributes": [
        {
          "_comment": "this is response metadata from LLM",
          "accessor": function ({ instance, response }) {
            return getLlmMetadata({ response, instance })
          }
        },
        {
          "_comment": "finish reason from Anthropic response",
          "attribute": "finish_reason",
          "accessor":function ({ args }) {
            try {
                // Arguments may be a dict with 'result' or just the response object
                const response = (typeof args === 'object' && args !== null && 'result' in args) 
                  ? args.result 
                  : args;

                if (response !== null && response !== undefined && 'stop_reason' in response) {
                  return response.stop_reason;
                }
              } catch (e) {
                console.warn("Warning: Error occurred in extract_finish_reason:", e);
                return null;
              }
              return null;
            }
        },
        // {
        //   "_comment": "finish type mapped from finish reason",
        //   "attribute": "finish_type",
        //   "accessor": function ({ instance, response }) {
        //     return getLlmMetadata({ response, instance })
        //   }
        // },
        {
          "attribute": "inference_sub_type",
          "accessor":  function ({ args , response}) {
            try {
              console.log(response)
              const status = getStatusCode(args);
              if (status === 'success' || status === 'completed') {                
                // Check if stop_reason indicates tool use
                if (response && 'stop_reason' in response && response.stop_reason === "tool_use") {
                  // Check if this is agent delegation by looking at tool names
                  if (response.content && Array.isArray(response.content)) {
                    const agentPrefix = context.active().getValue(AGENT_PREFIX_KEY);
                    for (const contentBlock of response.content) {
                      if (contentBlock.type === "tool_use" && contentBlock.name) {
                        const toolName = contentBlock.name;
                        if (agentPrefix && toolName.startsWith(agentPrefix)) {
                          return INFERENCE_AGENT_DELEGATION;
                        }
                      }
                    }
                    // If we found tool use but no agent delegation, it's a regular tool call
                    return INFERENCE_TOOL_CALL;
                  }
                }
                
                // Fallback: check the extracted message for tool content
                const assistantMessage = extractAssistantMessage(args);
                if (assistantMessage) {
                  try {
                    const message = JSON.parse(assistantMessage);
                    if (message && typeof message === 'object') {
                      const assistantContent = message.assistant || "";
                      if (assistantContent) {
                        const agentPrefix = context.active().getValue(AGENT_PREFIX_KEY);
                        if (agentPrefix && assistantContent.includes(agentPrefix)) {
                          return INFERENCE_AGENT_DELEGATION;
                        }
                      }
                    }
                  } catch (error) {
                    // If JSON parsing fails, fall back to string analysis
                    const agentPrefix = context.active().getValue(AGENT_PREFIX_KEY);
                    if (agentPrefix && assistantMessage.includes(agentPrefix)) {
                      return INFERENCE_AGENT_DELEGATION;
                    }
                  }
                }
              }
              
              return INFERENCE_COMMUNICATION;
            } catch (e) {
              console.warn("Warning: Error occurred in agent_inference_type:", e);
              return INFERENCE_COMMUNICATION;
            }
          }
        }
      ]
    },
  ]
}

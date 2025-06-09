import { detectSdkType, extractInferenceEndpoint } from "../../../common/utils";
import { extractAssistantMessage, getExceptionMessage, getLlmMetadata, getStatus, getStatusCode } from "../../utils";

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
        }
      ]
    },
  ]
}

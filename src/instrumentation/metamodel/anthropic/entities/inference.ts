import { detectSdk } from "../../../common/spanHandler.js";
import { extractAssistantMessage, getLlmMetadata } from "../../utils.js"

export const config = {
  "type": "inference",
  "attributes": [
    [
      {
        "_comment": "provider type ,name , deployment , inference_endpoint",
       "attribute": "type",
       "accessor": function ({instance, args}) {
        const sdk = detectSdk(instance, args);
        return `${sdk.sdkType}.${sdk.sdkName}`;
      }
      },
      {
        "attribute": "deployment",
        "accessor": function ({ instance }) {
          return instance.engine || instance.deployment || instance.deployment_name || instance.deployment_id || instance.azure_deployment
        }
      },
      {
        "attribute": "inference_endpoint",
        "accessor": function ({ instance }) {
          return instance.azure_endpoint || instance.api_base || instance?.client?.baseURL
        }
      }
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
          "accessor": function ({ response }) {
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
        }
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

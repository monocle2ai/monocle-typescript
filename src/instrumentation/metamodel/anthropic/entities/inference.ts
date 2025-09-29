
import { detectSdkType, extractInferenceEndpoint } from "../../../common/utils";
import { extractAssistantMessage, getExceptionMessage, getLlmMetadata, getStatus, getStatusCode } from "../../utils";

function processAnthropicStream({ element, returnValue, spanProcessor }) {
  let waitingForFirstToken = true;
  const streamStartTime = Date.now();
  let firstTokenTime = streamStartTime;
  let streamClosedTime = null;
  let accumulatedResponse = '';
  let tokenUsage = null;

  function patchInstanceMethod(obj, methodName, func) {
    const originalProto = Object.getPrototypeOf(obj);
    const newProto = Object.create(originalProto);
    newProto[methodName] = func;
    Object.setPrototypeOf(obj, newProto);
  }
  let handled = false;

  // Sync iterator (for-of)
  if (element && typeof returnValue[Symbol.iterator] === 'function') {
    handled = true;
    const originalIter = returnValue[Symbol.iterator].bind(returnValue);
    function* newIter() {
      for (const item of originalIter()) {
        try {
          // Anthropic streaming chunk: {type: 'content_block_delta', delta: {text: ...}}
          if (item.type === 'content_block_delta' && item.delta && typeof item.delta.text === 'string') {
            if (waitingForFirstToken) {
              waitingForFirstToken = false;
              firstTokenTime = Date.now();
            }
            accumulatedResponse += item.delta.text;
          }
                  // End of stream: {type: 'content_block', ...}
          if (item.type === 'content_block') {
            streamClosedTime = Date.now();
            if (item.text) {
              accumulatedResponse = item.text; // Use full text from final block
            }
          }
          // Usage info (if present)
          if (item.usage) {
            tokenUsage = item.usage;
          }
        } catch (e) {
          console.warn("Anthropic stream iterator error:", e);
        } finally {
          yield item;
        }
      }
      if (spanProcessor) {
        const retVal = {
          type: "stream",
          timestamps: {
            "data.input": streamStartTime,
            "data.output": firstTokenTime,
            "metadata": streamClosedTime || Date.now(),
          },
          output_text: accumulatedResponse,
          usage: tokenUsage,
        };
        spanProcessor({ finalReturnValue: retVal });
      }
    }
    patchInstanceMethod(returnValue, Symbol.iterator, newIter);
  }

  // Async iterator (for-await-of)
  if (element && typeof returnValue[Symbol.asyncIterator] === 'function') {
    handled = true;
    const originalAIter = returnValue[Symbol.asyncIterator].bind(returnValue);
    async function* newAIter() {
      for await (const item of originalAIter()) {
        try {
          if (item.type === 'content_block_delta' && item.delta && typeof item.delta.text === 'string') {
            if (waitingForFirstToken) {
              waitingForFirstToken = false;
              firstTokenTime = Date.now();
            }
            accumulatedResponse += item.delta.text;
          }
          if (item.type === 'content_block' && item.text) {
            streamClosedTime = Date.now();
          }
          if (item.usage) {
            tokenUsage = item.usage;
          }
        } catch (e) {
          console.warn("Anthropic stream asyncIterator error:", e);
        } finally {
          yield item;
        }
      }
      if (spanProcessor) {
        const retVal = {
          type: "stream",
          timestamps: {
            "data.input": streamStartTime,
            "data.output": firstTokenTime,
            "metadata": streamClosedTime || Date.now(),
          },
          output_text: accumulatedResponse,
          usage: tokenUsage,
        };
        spanProcessor({ finalReturnValue: retVal });
      }
    }
    patchInstanceMethod(returnValue, Symbol.asyncIterator, newAIter);
  }

  // Non-streaming case
  if (!handled && spanProcessor && returnValue && typeof returnValue === "object") {
    spanProcessor({ finalReturnValue: returnValue });
  }
}


export const config = {
  "type": "inference",
  "attributes": [
    [
      {
        "_comment": "provider type, name, deployment, inference_endpoint",
        "attribute": "type",
        "accessor": function ({ instance }) {
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
  "response_processor": processAnthropicStream,
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
                .map(msg => JSON.stringify({
                  [msg.role || msg.constructor?.name || "unknown"]: msg.content
                }));
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
            // First check for streamed response
          if (response?.output_text !== undefined) {
              return response.output_text;
          }
          // Then check for content array (Claude 3 format)
          if (response?.content && Array.isArray(response.content)) {
              const textContent = response.content
                  .filter(item => item.type === 'text')
                  .map(item => item.text)
                  .join('');
              if (textContent) return textContent;
          }
          // Then check for direct string content
          if (response?.content && typeof response.content === 'string') {
              return response.content;
          }
          // Finally try to extract from any other format
          const extracted = extractAssistantMessage(response);
          if (extracted) return extracted;
          
          return "unknown_response";
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
      ]
    },
  ]
}

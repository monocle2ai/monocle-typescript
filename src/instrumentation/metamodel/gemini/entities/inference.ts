import { mapGeminiFinishReasonToFinishType } from "../../finishType";
import {
  GEMINI_FUNCTION_CALL_FINISH_REASON,
  INFERENCE_TOOL_CALL,
  INFERENCE_TURN_END,
  TOOL_FUNCTION_TYPE,
} from "../../../common/constants";
import {
  extractGeminiEndpoint,
  getStatusCode,
  resolveFromAlias,
} from "../../utils";


// Collects declared tool names from config.tools (genai/ADK shape) or
// params.tools, accepting functionDeclarations or function_declarations.
function extractToolNames(args: any): string[] {
  try {
    const params = args?.[0];
    if (!params || typeof params !== "object") return [];
    const toolGroups = params.config?.tools ?? params.tools;
    if (!Array.isArray(toolGroups)) return [];
    const names: string[] = [];
    for (const group of toolGroups) {
      const declarations =
        group?.functionDeclarations ?? group?.function_declarations;
      if (Array.isArray(declarations)) {
        for (const declaration of declarations) {
          if (declaration?.name) names.push(declaration.name);
        }
      }
    }
    return names;
  } catch (e) {
    console.warn("Warning: Error occurred in extractToolNames:", e);
    return [];
  }
}

// Pulls functionCall parts out of the first candidate — emitted on tool calls /
// sub-agent delegation. Drives both finish-reason synthesis and output extraction.
function extractFunctionCalls(response: any): any[] {
  try {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return [];
    return parts.map((p: any) => p?.functionCall).filter((fc: any) => fc);
  } catch (e) {
    console.warn("Warning: Error occurred in extractFunctionCalls:", e);
    return [];
  }
}

function extractFinishReason(response: any): string | null {
  try {
    if (response && response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      // Tool-call detection takes priority: Gemini sets finishReason to
      // "STOP" even when the model produced a functionCall part, so we
      // synthesize "FUNCTION_CALL" when any part of the response is a
      // function-call. That lets the finishReason → finishType mapping
      // classify it correctly as a tool_call.
      if (extractFunctionCalls(response).length > 0) {
        return GEMINI_FUNCTION_CALL_FINISH_REASON;
      }
      if (candidate.finishReason) {
        return candidate.finishReason;
      }
    }
  } catch (e) {
    console.warn("Warning: Error occurred in extractFinishReason:", e);
    return null;
  }
  return null;
}


function getMetadataUsage(response, _instance) {
  try {
    let metadata = null;
    if (response && response.usageMetadata) {
      metadata = response.usageMetadata;
    } else if (
      response &&
      response.response &&
      response.response.usageMetadata
    ) {
      metadata = response.response.usageMetadata;
    } else if (response && response.usage) {
      metadata = response.usage;
    }
    if (metadata) {
      // Per Gemini's GenerateContentResponseUsageMetadata:
      //   total_tokens = prompt + candidates + tool_use_prompt + thoughts
      // (cached_tokens is *included in* prompt; it's reported separately for
      // billing visibility but must NOT be added to the sum.)
      // Reporting all fields keeps the math reconcilable: a consumer can
      // verify total = prompt + completion + tool_use_prompt + thoughts.
      const promptTokens = metadata.promptTokenCount ?? metadata.input_tokens ?? 0;
      const completionTokens = metadata.candidatesTokenCount ?? metadata.output_tokens ?? 0;
      const totalTokens = metadata.totalTokenCount ?? metadata.total_tokens ?? 0;
      const thoughtsTokens = metadata.thoughtsTokenCount ?? 0;
      const toolUsePromptTokens = metadata.toolUsePromptTokenCount ?? 0;
      const cachedTokens = metadata.cachedContentTokenCount ?? 0;

      const usage: Record<string, number> = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      };
      // Only emit the optional fields when they're actually present (>0), to
      // keep spans clean for models/responses that don't use thinking, tools,
      // or caching.
      if (thoughtsTokens > 0) usage.thoughts_tokens = thoughtsTokens;
      if (toolUsePromptTokens > 0) usage.tool_use_prompt_tokens = toolUsePromptTokens;
      if (cachedTokens > 0) usage.cached_tokens = cachedTokens;

      return usage;
    }
  } catch (e) {
    console.warn(`Warning: Error occurred in extracting Gemini metadata: ${e}`);
  }

  return null;
}

// Flattens any @google/genai content shape — string, Content ({ parts }),
// Part ({ text }), or an array of those — into a single text string.
function flattenContentText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(flattenContentText).filter((t) => t).join(" ");
  }
  if (value.parts && Array.isArray(value.parts)) {
    return value.parts
      .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
      .filter((text: string) => text)
      .join(" ");
  }
  if (typeof value.text === "string") return value.text;
  return "";
}

function extractMessages(args) {
  const params = args[0];
  const messages = [];

  if (params && typeof params === "object") {
    // ADK (and direct genai callers) pass the agent/system prompt via
    // config.systemInstruction rather than in contents, so capture it first.
    const systemInstruction =
      params.config?.systemInstruction ?? params.systemInstruction;
    const systemText = flattenContentText(systemInstruction);
    if (systemText) {
      messages.push(JSON.stringify({ system: systemText }));
    }
  }

  if (params && typeof params === "object") {
    if (typeof params.contents === "string") {
      messages.push(params.contents);
      return messages;
    } else if (Array.isArray(params.contents)) {
      for (const content of params.contents) {
        if (typeof content === "string") {
          messages.push(JSON.stringify({ "user": content }));
        } else if (content && content.parts && Array.isArray(content.parts)) {
          const role = content.role || "unknown_role";
          // For Gemini's parts structure, combine all text parts under one role
          const combinedText = content.parts
            .map(part => typeof part === "string" ? part : part?.text || "")
            .filter(text => text)
            .join(" ");
          if (combinedText) {
            messages.push(JSON.stringify({ [role]: combinedText }));
          }
        }
      }
    } else if (params.contents && params.contents.parts && Array.isArray(params.contents.parts)) {
      const role = params.contents.role || "unknown_role";
      const combinedText = params.contents.parts
        .map(part => typeof part === "string" ? part : part?.text || "")
        .filter(text => text)
        .join(" ");
      if (combinedText) {
        messages.push(JSON.stringify({ [role]: combinedText }));
      }
    }
  }
  return messages;
}

function extractInferenceOutput(result) {
  try {
    // Handle direct exception case
    if (result?.exception) {
      const error = result.exception;
      if (error.message) {
        return [error.message];
      }
      return [String(error)];
    }

    // Handle error in response structure
    if (result?.error) {
      return [result.error.message || JSON.stringify(result.error)];
    }

    // Handle API error structure
    if (result?.response?.error) {
      return [
        result.response.error.message || JSON.stringify(result.response.error),
      ];
    }

    const status = getStatusCode(result);

    if (status === "success") {
      let extractedText = "";

      // Try multiple paths to extract text from Gemini response
      if (result?.response?.text && result?.response.text.length > 0) {
        extractedText = result.response.text;
      } else if (result?.response?.candidates?.length > 0) {
        const candidate = result.response.candidates[0];

        // Check for text directly in candidate
        if (candidate.content?.parts?.length > 0) {
          const parts = candidate.content.parts;
          extractedText = parts.map((part) => part.text || "").join("");
        } else if (candidate.text) {
          extractedText = candidate.text;
        }
      } else if (result?.response?.text) {
        extractedText = result.response.text;
      } else if (result?.response?.candidates?.length > 0) {
        const candidate = result.response.candidates[0];
        if (candidate.content?.parts?.length > 0) {
          extractedText = candidate.content.parts
            .map((part) => part.text || "")
            .join("");
        }
      }

      if (extractedText && extractedText.length > 0) {
        return extractedText;
      }

      // No text part — the output is a tool call / delegation. Serialize the
      // functionCall(s) so the routing decision is captured, not an empty response.
      const functionCalls = extractFunctionCalls(result?.response);
      if (functionCalls.length > 0) {
        const serialized = functionCalls.map((fc) => ({
          function_call: { name: fc.name, args: fc.args },
        }));
        return JSON.stringify(serialized.length === 1 ? serialized[0] : serialized);
      }
    } else if (result?.error) {
      return result.error;
    }
    return "";
  } catch (e) {
    if (e instanceof TypeError || e.name === "TypeError") {
      console.warn(
        `Warning: Error occurred in extractAssistantMessage: ${e.message}`
      );
      return null;
    }
    throw e;
  }
}

// Classify an inference call as a tool-call dispatch or a normal end-of-turn
// response, based on Gemini's finish reason. Used as a dynamic span.subtype
// so traces can distinguish "the model wanted to call a tool" from "the
// model produced its final answer for this turn" at a glance.
function classifyInferenceSubtype(response: any): string {
  try {
    const finishReason = extractFinishReason(response);
    const finishType = mapGeminiFinishReasonToFinishType(finishReason);
    if (finishType === "tool_call") return INFERENCE_TOOL_CALL;
  } catch (e) {
    console.warn("Warning: Error occurred in classifyInferenceSubtype:", e);
  }
  return INFERENCE_TURN_END;
}

export const config = {
  type: "inference",
  subtype: function ({ response, output }: any) {
    return classifyInferenceSubtype(response ?? output);
  },
  attributes: [
    [
      {
        _comment: "provider type, inference_endpoint",
        attribute: "type",
        accessor: function ({ instance }) {
          if (instance && instance.apiClient && instance.apiClient.clientOptions) {
            const clientOptions = instance.apiClient.clientOptions;
            if (clientOptions.vertexai === true || clientOptions.project) {
              return "inference.vertexai";
            }
          }
          return "inference.gemini";
        },
      },
      {
        attribute: "inference_endpoint",
        accessor: function ({ instance }) {
          return extractGeminiEndpoint(instance);
        },
      },
    ],
    [
      {
        _comment: "LLM Model",
        attribute: "name",
        accessor: function ({ args }) {
          return resolveFromAlias(args, "model");
        },
      },
      {
        attribute: "type",
        accessor: function ({ args }) {
          const model = resolveFromAlias(args, "model");
          return "model.llm." + model;
        },
      },
    ],
    [
      {
        _comment: "tools declared on the request (e.g. ADK function tools)",
        attribute: "name",
        accessor: function ({ args }) {
          // Comma-separated string of declared tool names; undefined (not "")
          // when no tools, so the handler skips this entity.
          const names = extractToolNames(args);
          return names.length > 0 ? names.join(", ") : undefined;
        },
      },
      {
        attribute: "type",
        accessor: function ({ args }) {
          return extractToolNames(args).length > 0 ? TOOL_FUNCTION_TYPE : undefined;
        },
      },
    ],
  ],
  events: [
    {
      name: "data.input",
      attributes: [
        {
          _comment: "this is instruction and user query to LLM",
          attribute: "input",
          accessor: function ({ args }) {
            return extractMessages(args);
          },
        },
      ],
    },
    {
      name: "data.output",
      attributes: [
        {
          _comment: "this is result from LLM",
          attribute: "response",
          accessor: function ({ response, exception, args }) {
            return extractInferenceOutput({ response, exception, args });
          },
        },
      ],
    },
    {
      name: "metadata",
      attributes: [
        {
          _comment: "this is metadata usage from LLM",
          accessor: function ({ response, instance }) {
            return getMetadataUsage(response, instance);
          },
        },
        {
          "_comment": "finish reason from OpenAI response",
          "attribute": "finish_reason",
          "accessor": function ({ response }) {
            return extractFinishReason(response);
          }
        },
        {
          "_comment": "finish type mapped from finish reason",
          "attribute": "finish_type",
          "accessor": function ({ response }) {
            const finishReason = extractFinishReason(response);
            return mapGeminiFinishReasonToFinishType(finishReason);
          }
        }
      ],
    },
  ],
};

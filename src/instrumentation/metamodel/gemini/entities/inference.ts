import {
  extractGeminiEndpoint,
  getStatus,
  getStatusCode,
  resolveFromAlias,
} from "../../utils";

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
      const usage = {
        prompt_tokens: metadata.promptTokenCount || metadata.input_tokens || 0,
        completion_tokens:
          metadata.candidatesTokenCount || metadata.output_tokens || 0,
        total_tokens: metadata.totalTokenCount || metadata.total_tokens || 0,
      };

      return usage;
    }
  } catch (e) {
    console.warn(`Warning: Error occurred in extracting Gemini metadata: ${e}`);
  }

  return null;
}

function extractMessages(args) {
  const params = args[0];

  if (params && typeof params === "object") {
    const messages = [];

    if (typeof params.contents === "string") {
      messages.push(params.contents);
    } else if (Array.isArray(params.contents)) {
      for (const content of params.contents) {
        if (typeof content === "string") {
          messages.push(content);
        } else if (content && content.parts && Array.isArray(content.parts)) {
          for (const part of content.parts) {
            if (typeof part === "string") {
              messages.push(part);
            } else if (part && part.text) {
              const role = content.role || "user";
              messages.push(`{ '${role}': '${part.text}' }`);
            }
          }
        }
      }
    } else if (
      params.contents &&
      params.contents.parts &&
      Array.isArray(params.contents.parts)
    ) {
      for (const part of params.contents.parts) {
        if (typeof part === "string") {
          messages.push(part);
        } else if (part && part.text) {
          messages.push(part.text);
        }
      }
    }
    return messages;
  }
  return [];
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
    const messages: any[] = [];
    let role = "model";

    // Check if result has candidates with role information
    if (result?.candidates?.length > 0 && result.candidates[0]?.content?.role) {
      role = result.candidates[0].content.role;
    }

    if (status === "success") {
      let extractedText = "";

      // Try multiple paths to extract text from Gemini response
      if (result?.text && result.text.length > 0) {
        extractedText = result.text;
      } else if (result?.candidates?.length > 0) {
        const candidate = result.candidates[0];

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
        const messageObj = {};
        messageObj[role] = extractedText;
        messages.push(messageObj);
      }
    } else if (result?.error) {
      return result.error;
    }

    return messages.length > 0 ? JSON.stringify(messages[0]) : "";
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

export const config = {
  type: "inference",
  attributes: [
    [
      {
        _comment: "provider type, inference_endpoint",
        attribute: "type",
        accessor: function () {
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
          attribute: "status",
          accessor: function (args) {
            return getStatus(args);
          },
        },
        {
          attribute: "status_code",
          accessor: function (args) {
            return getStatusCode(args);
          },
        },
        {
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
      ],
    },
  ],
};

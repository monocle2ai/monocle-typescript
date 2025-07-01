import { getStatus, getStatusCode } from "../../utils";

function extractInferenceEndpoint(instance) {
  if (instance && instance.apiClient && instance.apiClient.clientOptions) {
    const clientOptions = instance.apiClient.clientOptions;

    return (
      clientOptions?.httpOptions?.baseUrl ||
      "https://generativelanguage.googleapis.com"
    );
  }
  return "https://generativelanguage.googleapis.com";
}

function resolveFromAlias(my_map, alias) {
  const params = my_map[0];
  if (params && typeof params === "object") {
    const aliases = Array.isArray(alias) ? alias : [alias];
    for (const i of aliases) {
      if (i in params && params[i] != null) {
        return params[i];
      }
    }
  }
  return null;
}

function updateSpanFromLlmResponse(response, _instance) {
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

function extractAssistantMessage(args) {
  const { response, exception } = args;

  if (exception) {
    return [exception.message || String(exception)];
  }

  try {
    if (response && typeof response.text === "function") {
      const responseText = response.text();
      return [responseText];
    }

    if (response && response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (
        candidate.content &&
        candidate.content.parts &&
        candidate.content.parts.length > 0
      ) {
        const responseText = candidate.content.parts[0].text || "";
        return [responseText];
      }
    }
  } catch (e) {
    console.warn(`Warning: Error occurred in extracting Gemini response: ${e}`);
  }
  return [];
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
          return extractInferenceEndpoint(instance);
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
          accessor: function (args) {
            return extractAssistantMessage(args);
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
            return updateSpanFromLlmResponse(response, instance);
          },
        },
      ],
    },
  ],
};

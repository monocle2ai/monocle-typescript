import {
  extractGeminiEndpoint,
  getStatus,
  getStatusCode,
  resolveFromAlias,
} from "../../utils";

function extractEmbeddingInput(args) {
  const params = args[0];

  if (params && typeof params === "object") {
    const inputs = [];

    if (typeof params.contents === "string") {
      inputs.push(params.contents);
    } else if (Array.isArray(params.contents)) {
      for (const item of params.contents) {
        if (typeof item === "string") {
          inputs.push(item);
        } else if (item && item.text) {
          inputs.push(item.text);
        }
      }
    }

    return inputs.length > 0 ? inputs : [""];
  }
  return [""];
}

function extractEmbeddingOutput(result) {
  
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
    return [result.response.error.message || JSON.stringify(result.response.error)];
  }
  
  const response = result?.response || result;
  
  // Handle successful embedding response
  if (
    response &&
    response.embeddings &&
    response.embeddings[0] &&
    response.embeddings[0].values
  ) {
    const embedding: any[] = response.embeddings[0].values;
    return embedding.slice(0, 10).toString() + "...";
  }

  const exception = result?.exception || null;
  if (exception) {
    return [exception.message || String(exception)];
  }

  return ["Unknown embedding response."];
}

export const config = {
  type: "embedding",
  attributes: [
    [
      {
        _comment: "provider type, embedding_endpoint",
        attribute: "type",
        accessor: function () {
          return "embedding.gemini";
        },
      },
      {
        attribute: "embedding_endpoint",
        accessor: function ({ instance }) {
          return extractGeminiEndpoint(instance);
        },
      },
    ],
    [
      {
        _comment: "Embedding Model",
        attribute: "name",
        accessor: function ({ args }) {
          return resolveFromAlias(args, ["model", "embeddingModel"]);
        },
      },
      {
        attribute: "type",
        accessor: function ({ args }) {
          const model = resolveFromAlias(args, ["model", "embeddingModel"]);
          return "model.embedding." + model;
        },
      },
    ],
  ],
  events: [
    {
      name: "data.input",
      attributes: [
        {
          _comment: "this is input text for embedding generation",
          attribute: "input",
          accessor: function ({ args }) {
            return extractEmbeddingInput(args);
          },
        },
      ],
    },
    {
      name: "data.output",
      attributes: [
        {
          _comment: "this is result from embedding service",
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
            return extractEmbeddingOutput({ response, exception, args });
          },
        },
      ],
    },
  ],
};

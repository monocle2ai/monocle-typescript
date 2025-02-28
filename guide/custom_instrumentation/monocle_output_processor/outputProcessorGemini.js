const GEMINI_OUTPUT_PROCESSOR = {
  type: "inference",
  attributes: [
    [
      {
        _comment: "provider type, name, deployment, inference_endpoint",
        attribute: "type",
        accessor: () => "gemini"
      },
      {
        attribute: "provider_name",
        accessor: () => "Google"
      },
      {
        attribute: "deployment",
        accessor: arguments => {
          // Try to extract model name from the model settings
          if (arguments.instance && arguments.instance.model) {
            return arguments.instance.model;
          }
          return "unknown";
        }
      },
      {
        attribute: "inference_endpoint",
        accessor: () => "generative-ai.googleapis.com"
      }
    ],
    [
      {
        _comment: "LLM Model",
        attribute: "name",
        accessor: arguments => {
          if (arguments.instance && arguments.instance.model) {
            return arguments.instance.model;
          }
          return "unknown";
        }
      },
      {
        attribute: "type",
        _comment: "model.llm.<model_name>",
        accessor: arguments => {
          let model = "unknown";
          if (arguments.instance && arguments.instance.model) {
            model = arguments.instance.model;
          }
          return `model.llm.${model}`;
        }
      }
    ]
  ],
  events: [
    {
      name: "data.input",
      _comment: "",
      attributes: [
        {
          _comment: "this is input to Gemini LLM",
          attribute: "input",
          accessor: arguments => {
            const input = arguments.args[0];
            if (typeof input === 'string') {
              return [input];
            } else if (input && Array.isArray(input.parts)) {
              // Handle structured input with parts
              return input.parts.map(part => {
                if (typeof part === 'string') return part;
                return part.text || '';
              });
            }
            return [];
          }
        }
      ]
    },
    {
      name: "data.output",
      _comment: "",
      attributes: [
        {
          _comment: "this is output from Gemini LLM",
          attribute: "response",
          accessor: arguments => {
            if (!arguments.response.response) return null;
            
            // Handle Gemini response format
            if (typeof arguments.response.response.text === 'function') {
              try {
                return arguments.response.response.text();
              } catch (e) {
                // Fallback if text() fails
                return null;
              }
            }
            
            // Alternative response structure
            if (arguments.response.candidates && arguments.response.candidates.length > 0) {
              const candidate = arguments.response.candidates[0];
              if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                return candidate.content.parts[0].text || '';
              }
            }
            
            return null;
          }
        }
      ]
    },
    {
      name: "metadata",
      attributes: [
        {
          _comment: "this is metadata usage from Gemini LLM",
          accessor: arguments => {
            // Extract usage metadata if available
            const metadata = arguments.response?.response?.usageMetadata;
            if (metadata) {
              return {
                  prompt_tokens: metadata.promptTokenCount || 0,
                  completion_tokens: metadata.candidatesTokenCount || 0,
                  total_tokens: metadata.totalTokenCount || 0
              };
            }
            return
          }
        }
      ]
    }
  ]
};

module.exports = { GEMINI_OUTPUT_PROCESSOR };

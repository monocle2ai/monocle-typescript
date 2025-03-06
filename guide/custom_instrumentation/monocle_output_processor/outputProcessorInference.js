const INFERENCE_OUTPUT_PROCESSOR = {
  type: "inference",
  attributes: [
    [
      {
        _comment: "provider type, name, deployment, inference_endpoint",
        attribute: "type",
        accessor: () => "openai"
      },
      {
        attribute: "provider_name",
        accessor: () => "OpenAI"
      },
      {
        attribute: "deployment",
        accessor: arguments => arguments.args[1] || "unknown"
      },
      {
        attribute: "inference_endpoint",
        accessor: arguments => arguments.instance.baseUrl
      }
    ],
    [
      {
        _comment: "LLM Model",
        attribute: "name",
        accessor: arguments => arguments.args[1] || "unknown"
      },
      {
        attribute: "type",
        _comment: "model.llm.<model_name>",
        accessor: arguments => `model.llm.${arguments.args[1] || "unknown"}`
      }
    ]
  ],
  events: [
    {
      name: "data.input",
      _comment: "",
      attributes: [
        {
          _comment: "this is input to LLM, the accessor extracts only the message contents",
          attribute: "input",
          accessor: arguments => {
            const messages = arguments.args[0] || [];
            return Array.isArray(messages) 
              ? messages.map(msg => msg.content) 
              : [];
          }
        }
      ]
    },
    {
      name: "data.output",
      _comment: "",
      attributes: [
        {
          _comment: "this is output from LLM, it includes the string response which is part of a list",
          attribute: "response",
          accessor: arguments => {
            if (!arguments.response?.choices?.length) return null;
            return arguments.response.choices[0].message.content;
          }
        }
      ]
    },
    {
      name: "metadata",
      attributes: [
        {
          _comment: "this is metadata usage from LLM",
          accessor: arguments => arguments.response?.usage || {}
        }
      ]
    }
  ]
};

module.exports = { INFERENCE_OUTPUT_PROCESSOR };

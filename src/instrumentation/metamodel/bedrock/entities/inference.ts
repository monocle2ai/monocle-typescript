export const config = {
  type: "inference",
  attributes: [
    [
      {
        attribute: "name",
        accessor: function ({ args }) {
          if (args && args[0] && args[0].input) {
            return args[0].input.modelId;
          }
          return null;
        }
      },
      {
        attribute: "type",
        accessor: function ({ args }) {
          if (args && args[0] && args[0].input && args[0].input.modelId) {
            return "model.llm." + args[0].input.modelId;
          }
          return null;
        }
      }
    ]
  ],

  events: [
    {
      name: "data.input",
      attributes: [
        {
          _comment: "this is input to LLM",
          attribute: "input",
          accessor: function ({ args }) {
            try {
              if (!args || !args[0] || !args[0].input || !args[0].input.body) {
                return [];
              }
              const bodyContent = JSON.parse(args[0].input.body);
              if (bodyContent.messages) {
                return [JSON.stringify({
                  [bodyContent.messages[0].role || bodyContent.messages[0].constructor?.name || "unknown"]: bodyContent.messages[0].content
                })];
              }
              return [JSON.stringify(bodyContent)];
            } catch (e) {
              console.error("Error parsing input body:", e);
              return [];
            }
          }
        }
      ]
    },
    {
      name: "data.output",
      attributes: [
        {
          _comment: "this is response from LLM",
          attribute: "response",
          accessor: function (data) {
            if (data && data.response && data.response.body) {
              try {
                const buffer = Buffer.from(data.response.body);
                const decodedResponse = buffer.toString();
                const parsedResponse = JSON.parse(decodedResponse);

                if (parsedResponse.completion) {
                  return parsedResponse.completion.trim();
                }
                if (parsedResponse.content) {
                  return parsedResponse.content[0].text.trim();
                }
                if (Array.isArray(parsedResponse.embedding)) {
                  // only return first 10 elements
                  return parsedResponse.embedding.slice(0, 10).toString() + "...";
                }

                return JSON.stringify(parsedResponse);
              } catch (e) {
                console.error("Error parsing response:", e);
                return ["Error parsing response"];
              }
            }
            return ["No response data"];
          }
        }
      ]
    }
  ]
};

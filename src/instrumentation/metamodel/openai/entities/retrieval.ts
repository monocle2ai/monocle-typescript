import { extractAssistantMessage } from "../../utils";

export const config = {
  type: "retrieval",
  attributes: [
    [
      {
        _comment: "LLM Model",
        attribute: "name",
        accessor: function ({ instance }) {
          if (instance?.vectorStore?.constructor?.name) {
            return "vectorstore." + instance?.vectorStore?.constructor?.name;
          }
          return "";
        }
      },
      {
        attribute: "type",
        accessor: function ({ instance }) {
          if (instance?.vectorStore?.constructor?.name) {
            return (
              "model.embedding." + instance?.vectorStore?.constructor?.name
            );
          }
          return "";
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
          accessor: function ({
            args
            // instance
          }) {
            if (args[0].value && typeof args[0].value === "string") {
              return args[0].value;
            }
            if (args[0] && typeof args[0] === "string") {
              return args[0];
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
          accessor: function ({ response }) {
            return extractAssistantMessage(response);
          }
        }
      ]
    }
  ]
};

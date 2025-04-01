import { getLlmMetadata } from "../../utils";

export const config = {
  type: "inference",
  attributes: [
    [
      {
        _comment: "planner type and configuration",
        attribute: "type",
        accessor: () => "teams.planner"
      },
      {
        attribute: "planner_type",
        accessor: () => "ActionPlanner"
      },
      {
        attribute: "max_repair_attempts",
        accessor: ({ args }) => {
          return args[2]?.config?.completion?.max_repair_attempts ?? 3;
        }
      }
    ],
    [
      {
        _comment: "model configuration",
        attribute: "model",
        accessor: ({ args }) => {
          return args[2]?.config?.completion?.model || "unknown";
        }
      },
      {
        attribute: "tokenizer",
        accessor: ({ args }) => {
          return args[3]?.constructor?.name || "GPTTokenizer";
        }
      }
    ]
  ],
  events: [
    {
      name: "data.input",
      _comment: "input configuration to ActionPlanner",
      attributes: [
        {
          attribute: "prompt_name",
          accessor: ({ args }) => {
            return args[2]?.name || "unknown";
          }
        },
        {
          attribute: "validator",
          accessor: ({ args }) => {
            return (
              args[3]?.__proto__?.constructor?.name ||
              "DefaultResponseValidator"
            );
          }
        },
        {
          attribute: "memory_type",
          accessor: ({ args }) => {
            if (args[1]?._scopes) {
              return Object.keys(args[1]._scopes).join(", ");
            }
            return "unknown";
          }
        }
      ]
    },
    {
      name: "data.output",
      _comment: "output from ActionPlanner",
      attributes: [
        {
          attribute: "status",
          accessor: ({ response }) => {
            return response.status;
          }
        },
        {
          attribute: "response",
          accessor: ({ response }) => {
            try {
              const messageContent = response?.message?.content || "";
              const parsedContent = JSON.parse(messageContent);

              return (
                parsedContent?.results?.[0]?.answer || "No response available"
              );
            } catch (error) {
              console.error("Error extracting response:", error);
              return "Error parsing response";
            }
          }
        }
      ]
    },
    {
      name: "metadata",
      attributes: [
        {
          _comment: "execution metadata",
          accessor: function ({ instance, response }) {
            return getLlmMetadata({ response, instance });
          }
        }
      ]
    }
  ]
};

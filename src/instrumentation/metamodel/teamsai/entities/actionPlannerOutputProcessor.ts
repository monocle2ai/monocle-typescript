import { getLlmMetadata } from "../../utils";

export const config = {
  type: "generic",
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

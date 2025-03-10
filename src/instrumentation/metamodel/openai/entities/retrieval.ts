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

          accessor: function ({ args }) {
            const inputUser = args[0].messages.filter(
              (item) => item.role == "user"
            )[0]?.content;
            const inputSystem = args[0].messages.filter(
              (item) => item.role == "system"
            )[0]?.content;
            const retVal: string[] = [];
            if (inputUser) {
              retVal.push(inputUser);
            }
            if (inputSystem) {
              retVal.push(inputSystem);
            }
            return retVal;
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
            return [response.choices[0].message.content];
          }
        }
      ]
    }
  ]
};

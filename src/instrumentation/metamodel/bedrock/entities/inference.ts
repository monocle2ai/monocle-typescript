import { placedFirst } from "../../../../instructions/sending";

// A Converse or ConverseStream command, rebuilt with the instruction as its first
// `system` block. Other commands (InvokeModel, whose body differs per model) carry none.
export function addInstruction(command: any, text: string): any | null {
  const input = command?.input;
  if (!Array.isArray(input?.messages) || typeof command.constructor !== "function") {
    return null;
  }
  const system = placedFirst({ text }, Array.isArray(input.system) ? input.system : []);
  return new command.constructor({ ...input, system });
}

export const config = {
  type: "inference",
  add_instruction: addInstruction,
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
              if (bodyContent.prompt) {
                return [bodyContent.prompt]; // Return full prompt if can't extract
              }

              if (bodyContent.inputText) {
                return [bodyContent.inputText];
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
                  return [parsedResponse.completion.trim()];
                }
                if(Array.isArray(parsedResponse.embedding)) {
                  // only return first 10 elements
                  return [parsedResponse.embedding.slice(0, 10).toString() + "..."]; 
                }

                return [JSON.stringify(parsedResponse)];
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

import { ACCESSOR_ARGS } from "../../utils";

export const config = {
  type: "inference",
  attributes: [
      [
          {
              "_comment": "LLM Model",
              "attribute": "name",
              "accessor": function ({ args }: ACCESSOR_ARGS) {
                  return args[0].model.modelId
              }
          },
          {
              "attribute": "type",
              "_comment": "model.llm.<model_name>",
              "accessor": function ({ args }: ACCESSOR_ARGS) {
                  return "model.llm." + args[0].model.modelId;
              }
          }
      ],
      [
          {
              "_comment": "inference type",
              "attribute": "type",
              "accessor": function ({ args }: ACCESSOR_ARGS) {
                  const providerName: string = args[0].model.config.provider;
                  if (providerName && providerName.toLowerCase().startsWith("openai")){
                      return "inference.openai";
                  }
                  if (providerName && providerName.toLowerCase().startsWith("azure-openai")){
                      return "inference.azure_openai";
                  }
                  if( providerName && providerName.toLowerCase().startsWith("anthropic")){
                      return "inference.anthropic";
                  }
                  if( providerName && providerName.toLowerCase().startsWith("amazon-bedrock")){
                      return "inference.aws_bedrock";
                  }

                  return null;
              }
          },
          {
              "_comment": "inference deployment",
              "attribute": "deployment",
              "accessor": function ({ args }: ACCESSOR_ARGS) {
                  
                  const providerName: string = args[0].model.config.provider;
                  if (providerName && providerName.toLowerCase().startsWith("azure-openai")){
                      return args[0].model.modelId;
                  }
                  return;
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
                  accessor: ({ args }: ACCESSOR_ARGS) => {
                      const messages = [];
                      if(args[0] && typeof args[0].system === 'string') {
                          messages.push(`{ '${"system"}': '${args[0].system}' }`);
                      }
                      if(args[0] && typeof args[0].prompt === 'string') {
                          messages.push(`{ '${"prompt"}': '${args[0].prompt}' }`);
                      }
                      return messages;
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
                  accessor: ({ response }: ACCESSOR_ARGS) => {
                      if(response.text){
                          return [response.text];
                      }
                      return []
                  }
              }
          ]
      }
  ]
};
import { extractTeamsAiInfo } from "../../utils";

export const config = {
  type: "inference",
  attributes: [
    [
      {
        _comment: "provider type, name, deployment",
        attribute: "type",
        accessor: ({ instance }) => {
          if (instance._client.constructor.name === "AzureOpenAI") {
            return "inference.azure_openai";
          }
          return "inference.openai";
        }
      },
      {
        attribute: "provider_name",
        accessor: () => "Microsoft Teams AI"
      },
      {
        attribute: "inference_endpoint",
        accessor: ({ instance }) => {
          if (instance._client.constructor.name === "AzureOpenAI") {
            return instance._client.baseURL;
          }
          return "https://api.openai.com/";
        }
      },
      {
        attribute: "deployment",
        accessor: ({ instance }) => {
          // Access PromptManager options (index 2)
          return instance.options.azureDefaultDeployment
        }
      }
    ],
    [
      {
        _comment: "LLM Model",
        attribute: "name",
        accessor: ({ instance }) => {
          // Attempt to extract model name from various possible locations
          return instance.options.azureDefaultDeployment
        }
      },
      {
        _comment: "LLM Model",
        attribute: "type",
        accessor: ({ instance }) => {
          // Attempt to extract model name from various possible locations
          return "model.llm." + instance.options.azureDefaultDeployment
        }
      }
    ]
  ],
  events: [
    {
      name: "data.input",
      _comment: "input to Teams AI",
      attributes: [
        {
          _comment: "this is instruction to LLM",
          attribute: "input",
          accessor: ({ args }) => {
            try {
              // Access args directly without destructuring
              const turnContext = args ? args[0] : null;
              // Safely access the activity text
              if (
                turnContext &&
                turnContext._activity &&
                typeof turnContext._activity.text === "string"
              ) {
                return turnContext._activity.text;
              }
              return "No input found";
            } catch (error) {
              console.error("Error accessing input:", error);
              return "Error retrieving input";
            }
          }
        }
      ]
    },

    {
      name: "data.output",
      _comment: "output from Teams AI",
      attributes: [
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
          _comment: "metadata from Teams AI response",
          accessor: ({ args }) => {
            // Calculate latency based on available information
            const startTime = extractTeamsAiInfo(
              args[1],
              "_loadingPromise",
              Date.now()
            );
            const endTime = Date.now();

            // Estimate latency based on prompt manager options
            const promptTokens = extractTeamsAiInfo(
              args[2],
              "_options.max_conversation_history_tokens",
              0
            );

            const completionTokens = extractTeamsAiInfo(
              args[4],
              "config.completion.max_tokens",
              0
            );

            return {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
              latency_ms: endTime - startTime
            };
          }
        }
      ]
    }
  ]
};

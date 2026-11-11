import { getExceptionMessage, getStatus, getStatusCode } from "../../utils";

const SYSTEM_ONE_PATH = "/v1/systemone";

function getModel({ instance, args, output }: any): string | undefined {
  return output?.model ?? args?.[0]?.model ?? instance?.defaultModel;
}

function extractInput(args: any): string[] {
  const request = args?.[0];
  if (!request) return [];
  return [JSON.stringify({ state: request.state }), JSON.stringify({ questions: request.questions })];
}

// Token usage plus extras OpenRouter adds (cost, byok flag, cost breakdown, ids).
// Event attributes must be flat strings/numbers (the handler drops the whole
// event otherwise), so cost_details is flattened and is_byok is a string.
function getMetadata(response: any): Record<string, number | string> | null {
  const usage = response?.usage;
  if (!usage) return null;
  const prompt = usage.input_tokens ?? 0;
  const completion = usage.output_tokens ?? 0;
  const result: Record<string, number | string> = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
  if (usage.cost !== undefined) result.cost = usage.cost;
  if (usage.is_byok !== undefined) result.is_byok = String(usage.is_byok);
  for (const [key, value] of Object.entries(usage.cost_details ?? {})) {
    if (typeof value === "number") result[key] = value;
  }
  if (response.id) result.response_id = response.id;
  if (response.provider) result.provider = response.provider;
  return result;
}

export const config = {
  type: "inference",
  attributes: [
    [
      {
        _comment: "provider type, inference_endpoint",
        attribute: "type",
        accessor: () => "inference.typesafe",
      },
      {
        attribute: "inference_endpoint",
        accessor: ({ instance }: any) =>
          instance?.baseURL ? instance.baseURL + SYSTEM_ONE_PATH : undefined,
      },
    ],
    [
      {
        _comment: "System One model, e.g. typesafe/jev-1.14-20261014",
        attribute: "name",
        accessor: (params: any) => getModel(params),
      },
      {
        attribute: "type",
        accessor: (params: any) => {
          const model = getModel(params);
          return model ? "model.llm." + model : undefined;
        },
      },
    ],
  ],
  events: [
    {
      name: "data.input",
      attributes: [
        {
          _comment: "state and typed questions sent to the model",
          attribute: "input",
          accessor: ({ args }: any) => extractInput(args),
        },
      ],
    },
    {
      name: "data.output",
      attributes: [
        {
          _comment: "typed answers with probabilities (no free text)",
          attribute: "response",
          accessor: ({ response, exception }: any) =>
            exception ? getExceptionMessage({ exception }) : JSON.stringify(response?.answers),
        },
        {
          attribute: "status",
          accessor: (params: any) => getStatus(params),
        },
        {
          attribute: "status_code",
          accessor: (params: any) => getStatusCode(params),
        },
      ],
    },
    {
      name: "metadata",
      attributes: [
        {
          _comment: "token usage, cost and provider extras",
          accessor: ({ response }: any) => getMetadata(response),
        },
      ],
    },
  ],
};

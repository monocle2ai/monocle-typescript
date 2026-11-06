import { getExceptionMessage, getStatus, getStatusCode } from "../../utils";

const SYSTEM_ONE_PATH = "/v1/systemone";

// Image/binary values in state would bloat the span; keep a placeholder.
function safeStringify(value: any): string {
  return JSON.stringify(value, (_key, val) => {
    if (val instanceof Uint8Array || val?.constructor?.name === "Image") return "[image]";
    return val;
  });
}

function getModel({ instance, args, output }: any): string | undefined {
  return output?.model ?? args?.[0]?.model ?? instance?.defaultModel;
}

function extractInput(args: any): string[] {
  const request = args?.[0];
  if (!request) return [];
  return [safeStringify({ state: request.state }), safeStringify({ questions: request.questions })];
}

function getUsage(response: any): Record<string, number> | null {
  const usage = response?.usage;
  if (!usage) return null;
  const prompt = usage.input_tokens ?? 0;
  const completion = usage.output_tokens ?? 0;
  const result: Record<string, number> = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
  if (usage.cost !== undefined) result.cost = usage.cost;
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
            exception ? getExceptionMessage({ exception }) : safeStringify(response?.answers),
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
          _comment: "token usage and cost",
          accessor: ({ response }: any) => getUsage(response),
        },
      ],
    },
  ],
};

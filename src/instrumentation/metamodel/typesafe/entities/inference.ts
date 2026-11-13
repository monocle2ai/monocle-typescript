import { DECISION_MODEL_PREFIX, MODEL_TYPE_ATTRIBUTE, MODEL_TYPE_DECISION } from "../../../common/constants";
import { mapDecisionFinishReasonToFinishType } from "../../finishType";
import { getExceptionMessage, getStatus, getStatusCode } from "../../utils";

const PROVIDER = "typesafe";
const SYSTEM_ONE_PATH = "/v1/systemone";

// The response carries the resolved model (e.g. "jev-1.14.0"), not the requested
// alias. Fall back to the alias when there is no response (errors).
function getModel({ instance, args, output }: any): string | undefined {
  return output?.model ?? args?.[0]?.model ?? instance?.defaultModel;
}

// One entry for the state, then one per named question.
function extractInput(args: any): string[] {
  const request = args?.[0];
  if (!request) return [];
  const entries = [JSON.stringify({ state: request.state })];
  for (const [name, question] of Object.entries(request.questions ?? {})) {
    entries.push(JSON.stringify({ [name]: question }));
  }
  return entries;
}

// A decision response has no finish reason: success on return, error on exception.
function getFinishReason(exception: any): string {
  return exception ? "error" : "success";
}

function getUsage(response: any): Record<string, number> | null {
  const usage = response?.usage;
  if (!usage) return null;
  const prompt = usage.input_tokens ?? 0;
  const completion = usage.output_tokens ?? 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
}

export const config = {
  type: "inference",
  attributes: [
    [
      {
        _comment: "provider type, inference_endpoint",
        attribute: "type",
        accessor: () => "inference." + PROVIDER,
      },
      {
        attribute: "provider_name",
        accessor: () => PROVIDER,
      },
      {
        attribute: "inference_endpoint",
        accessor: ({ instance }: any) =>
          instance?.baseURL ? instance.baseURL + SYSTEM_ONE_PATH : undefined,
      },
    ],
    [
      {
        _comment: "System One model, e.g. jev-1.14.0",
        attribute: "name",
        accessor: (params: any) => getModel(params),
      },
      {
        attribute: "type",
        accessor: (params: any) => {
          const model = getModel(params);
          return model ? DECISION_MODEL_PREFIX + model : undefined;
        },
      },
      {
        _comment: "decision model, not an LLM",
        attribute: MODEL_TYPE_ATTRIBUTE,
        accessor: () => MODEL_TYPE_DECISION,
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
          _comment: "token usage",
          accessor: ({ response }: any) => getUsage(response),
        },
        {
          attribute: "finish_reason",
          accessor: ({ exception }: any) => getFinishReason(exception),
        },
        {
          attribute: "finish_type",
          accessor: ({ exception }: any) =>
            mapDecisionFinishReasonToFinishType(getFinishReason(exception)),
        },
      ],
    },
  ],
};

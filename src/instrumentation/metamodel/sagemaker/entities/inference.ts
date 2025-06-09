function getExceptionMessage({ exception }: { exception: any }): string {
  if (exception.name && exception.message) {
    return `${exception.name}: ${exception.message}`;
  }

  if (typeof exception === "string") {
    return exception;
  }

  try {
    return JSON.stringify(exception);
  } catch (err) {
    return "Unknown error format";
  }
}

function getStatusCode({
  response,
  exception,
}: {
  response?: any;
  exception?: any;
}): string {
  if (exception) return "error";

  if (
    response &&
    response.$metadata?.httpStatusCode >= 200 &&
    response.$metadata?.httpStatusCode < 300
  ) {
    return "success";
  }

  return "error";
}

function getStatus({
  response,
  exception,
}: {
  response?: any;
  exception?: any;
}): number | string {
  if (exception && exception.$metadata?.httpStatusCode) {
    return exception.$metadata.httpStatusCode;
  }

  if (response && response.$metadata?.httpStatusCode) {
    return response.$metadata.httpStatusCode;
  }

  return "error";
}

export const config = {
  type: "inference",
  attributes: [
    [
      {
        attribute: "name",
        accessor: function ({ args }) {
          if (args && args[0] && args[0].input && args[0].input.EndpointName) {
            return args[0].input.EndpointName;
          }
          return null;
        }
      },
      {
        attribute: "type",
        accessor: function ({ args }) {
          if (args && args[0] && args[0].input && args[0].input.EndpointName) {
            return "model.llm." + args[0].input.EndpointName;
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
              if (args && args[0] && args[0].input && args[0].input.Body) {
                return [
                  args[0].input.Body
                ];
              }
            } catch (e) {
              console.error("Error parsing input body:", e);
              return [];
            }
            return [];
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
            if (data?.response instanceof Error) {
              return getExceptionMessage({ exception: data.response });
            }
            try {
              let decodedResponse;
              const buffer = Buffer.from(data.response.Body);
              decodedResponse = buffer.toString();
              decodedResponse = JSON.parse(decodedResponse);
              return [decodedResponse.answer || JSON.stringify(decodedResponse)];
            } catch (err) {
              return `Failed to parse response body: ${err.message}`;
            }
          }
        },
        {
          attribute: "status",
          accessor: (args) => {
            return getStatus(args);
          },
        },
        {
          attribute: "status_code",
          accessor: (args) => {
            return getStatusCode(args);
          },
        },
      ]
    }
  ]
};

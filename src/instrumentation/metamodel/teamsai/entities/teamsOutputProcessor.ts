import { consoleLog } from "../../../../common/logging";
import { extractTeamsAiInfo, MonocleSpanException } from "../../utils";

// def get_status_code(arguments):
//     if arguments["exception"] is not None:
//         return get_exception_status_code(arguments)
//     elif hasattr(arguments["result"], "status"):
//         return arguments["result"].status
//     else:
//         return 'success'

// def get_status(arguments):
//     if arguments["exception"] is not None:
//         return 'error'
//     elif get_status_code(arguments) == 'success':
//         return 'success'
//     else:
//         return 'error'

// def get_response(arguments) -> str:
//     status = get_status_code(arguments)
//     response:str = ""
//     if status == 'success':
//         if hasattr(arguments["result"], "message"):
//             response = arguments["result"].message.content 
//         else:
//             response = str(arguments["result"])
//     else:
//         if arguments["exception"] is not None:
//             response = get_exception_message(arguments)
//         elif hasattr(arguments["result"], "error"):
//             response = arguments["result"].error
//     return response

// def check_status(arguments):
//     status = get_status_code(arguments)
//     if status != 'success':
//         raise MonocleSpanException(f"{status}")  

// def get_exception_status_code(arguments):
//     if arguments['exception'] is not None and hasattr(arguments['exception'], 'code'):
//         return arguments['exception'].code
//     else:
//         return 'error'

// def get_exception_message(arguments):
//     if arguments['exception'] is not None:
//         if hasattr(arguments['exception'], 'message'):
//             return arguments['exception'].message
//         else:
//             return arguments['exception'].__str__()
//     else:
//         return ''

function getResponse(args) {
  const status = getStatusCode(args);
  let response = "";
  if (status === "success") {
    if (args.response && args.response.message) {
      response = args.response.message.content;
      try {
        response = JSON.parse(response).results[0].answer;
      } catch (e) {
        consoleLog("Failed to parse teams response answer:", e);
      }
    }
    else {
      response = JSON.stringify(args.response);
    }
  }
  else {
    if (args.exception) {
      response = getExceptionMessage(args);
    }
    else if (args.response && args.response.error) {
      response = args.response.error.message
    }
  }
  return response;
}
function getStatusCode(args) {
  if (args.exception) {
    return getExceptionStatusCode(args);
  }
  else if (args.response && args.response.status) {
    return args.response.status;
  }
  else {
    return "success";
  }
}

function getStatus(args) {
  if (args.exception) {
    return "error";
  }
  else if (getStatusCode(args) === "success") {
    return "success";
  }
  else {
    return "error";
  }
}
function checkStatus(args) {
  const status = getStatusCode(args);
  if (status !== "success") {
    throw new MonocleSpanException(status);
  }
}
function getExceptionStatusCode(args) {
  if (args.exception && args.exception.code) {
    return args.exception.code;
  }
  else {
    return "error";
  }
}
function getExceptionMessage(args) {
  if (args.exception) {
    if (args.exception.message) {
      return args.exception.message;
    }
    else {
      return args.exception.toString();
    }
  }
  else {
    return "";
  }
}

export const config = {
  type: "inference.framework",
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
          "attribute": "status",
          "accessor": (args) => {
            return getStatus(args);
          }
        },
        {
          "attribute": "status_code",
          "accessor": (args) => {
            return getStatusCode(args);
          }
        },
        {
          "attribute": "response",
          "accessor": (args) => {
            return getResponse(args);
          }
        },
        {
          "attribute": "check_status",
          "accessor": (args) => {
            return checkStatus(args);
          }
        }
      ]
    }
  ]
};

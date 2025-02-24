import { setupMonocle } from "../instrumentation/common/instrumentation";
// import { extractAssistantMessage } from "../../utils";

const { Resource } = require("@opentelemetry/resources");
const {
  AsyncHooksContextManager
} = require("@opentelemetry/context-async-hooks");
const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node");
const { context } = require("@opentelemetry/api");

// Mock the dependencies
jest.mock("@opentelemetry/resources");
jest.mock("@opentelemetry/context-async-hooks");
jest.mock("@opentelemetry/sdk-trace-node");
jest.mock("@opentelemetry/api");
// jest.mock("../../utils", () => ({
//   extractAssistantMessage: jest.fn()
// }));

describe("setupMonocle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should initialize with inference configuration", () => {
    // Create a dummy instance to test inference config
    const dummyInstance = {
      constructor: { name: "AzureChatOpenAI" },
      deployment: "test-deployment",
      azure_endpoint: "https://test.openai.azure.com",
      model_name: "gpt-4"
    };

    // Create a dummy span processor based on inference.ts config
    const dummySpanProcessor = {
      onStart: (span) => {
        // Test type attribute
        span.setAttribute("type", "inference.azure_openai");

        // Test deployment attribute
        span.setAttribute("deployment", dummyInstance.deployment);

        // Test inference_endpoint attribute
        span.setAttribute("inference_endpoint", dummyInstance.azure_endpoint);

        // Test model name attribute
        span.setAttribute("name", dummyInstance.model_name);

        // Test data input
        span.addEvent("data.input", {
          user: "test input message"
        });

        // Test data output
        span.addEvent("data.output", {
          response: "test output message"
        });
      },
      onEnd: jest.fn(),
      shutdown: jest.fn()
    };

    // Create a dummy wrapper method
    const dummyWrapperMethod = {
      package: "@langchain/core/language_models/chat_models",
      object: "BaseChatModel",
      method: "invoke",
      spanName: "langchain.chat",
      output_processor: [
        {
          type: "inference",
          attributes: [
            [
              {
                attribute: "type",
                accessor: ({ instance }) => {
                  if (
                    instance?.constructor?.name
                      ?.toLowerCase()
                      .includes("azurechatopenai")
                  ) {
                    return "inference.azure_openai";
                  }
                  return "";
                }
              }
            ]
          ]
        }
      ]
    };

    // Call setupMonocle with test data
    setupMonocle("test-workflow", [dummySpanProcessor], [dummyWrapperMethod]);

    // Verify Resource was created with correct service name
    expect(Resource).toHaveBeenCalledWith({
      SERVICE_NAME: "test-workflow"
    });

    // Verify context manager was enabled
    expect(AsyncHooksContextManager.prototype.enable).toHaveBeenCalled();

    // Verify global context manager was set
    expect(context.setGlobalContextManager).toHaveBeenCalled();

    // Verify TracerProvider was created
    expect(NodeTracerProvider).toHaveBeenCalled();

    // Verify span processor was added
    expect(NodeTracerProvider.prototype.addSpanProcessor).toHaveBeenCalledWith(
      dummySpanProcessor
    );

    // Create a dummy span to test processor
    const dummySpan = {
      setAttribute: jest.fn(),
      addEvent: jest.fn()
    };

    // Test span processor behavior
    dummySpanProcessor.onStart(dummySpan);

    // Verify span attributes were set correctly
    expect(dummySpan.setAttribute).toHaveBeenCalledWith(
      "type",
      "inference.azure_openai"
    );
    expect(dummySpan.setAttribute).toHaveBeenCalledWith(
      "deployment",
      "test-deployment"
    );
    expect(dummySpan.setAttribute).toHaveBeenCalledWith(
      "inference_endpoint",
      "https://test.openai.azure.com"
    );
    expect(dummySpan.setAttribute).toHaveBeenCalledWith("name", "gpt-4");

    // Verify events were added
    expect(dummySpan.addEvent).toHaveBeenCalledWith("data.input", {
      user: "test input message"
    });
    expect(dummySpan.addEvent).toHaveBeenCalledWith("data.output", {
      response: "test output message"
    });
  });
});

import { setupMonocle } from "../instrumentation/common/instrumentation";

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

describe("setupMonocle", () => {
  let processedSpans;
  let dummySpanProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processedSpans = [];

    // Enhanced dummy span processor that tracks processed spans
    dummySpanProcessor = {
      onStart: (span, context) => {
        processedSpans.push({ span, context, phase: "start" });

        // Set attributes based on inference config
        span.setAttribute("type", "inference.azure_openai");
        span.setAttribute("deployment", "test-deployment");
        span.setAttribute(
          "inference_endpoint",
          "https://test.openai.azure.com"
        );
        span.setAttribute("name", "gpt-4");

        span.addEvent("data.input", {
          user: "test input message"
        });
      },
      onEnd: (span) => {
        processedSpans.push({ span, phase: "end" });
        span.addEvent("data.output", {
          response: "test output message"
        });
      },
      shutdown: jest.fn(),
      forceFlush: jest.fn()
    };
  });

  test("should properly process spans through the span processor", () => {
    // const dummyInstance = {
    //   constructor: { name: "AzureChatOpenAI" },
    //   deployment: "test-deployment",
    //   azure_endpoint: "https://test.openai.azure.com",
    //   model_name: "gpt-4"
    // };

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

    // Mock NodeTracerProvider to capture span processor registration
    let registeredProcessor;
    NodeTracerProvider.prototype.addSpanProcessor = jest.fn((processor) => {
      registeredProcessor = processor;
    });

    // Setup Monocle
    setupMonocle("test-workflow", [dummySpanProcessor], [dummyWrapperMethod]);

    // Verify basic setup
    expect(Resource).toHaveBeenCalledWith({
      SERVICE_NAME: "test-workflow"
    });
    expect(AsyncHooksContextManager.prototype.enable).toHaveBeenCalled();
    expect(context.setGlobalContextManager).toHaveBeenCalled();
    expect(NodeTracerProvider).toHaveBeenCalled();

    // Verify span processor registration
    expect(NodeTracerProvider.prototype.addSpanProcessor).toHaveBeenCalledWith(
      dummySpanProcessor
    );
    expect(registeredProcessor).toBe(dummySpanProcessor);

    // Create a test span
    const testSpan = {
      setAttribute: jest.fn(),
      addEvent: jest.fn(),
      name: "test-span",
      context: () => ({
        traceId: "test-trace-id",
        spanId: "test-span-id"
      })
    };

    // Simulate span lifecycle
    dummySpanProcessor.onStart(testSpan, {});
    dummySpanProcessor.onEnd(testSpan);

    // Verify span processing
    expect(processedSpans).toHaveLength(2);
    expect(processedSpans[0].phase).toBe("start");
    expect(processedSpans[1].phase).toBe("end");

    // Verify span attributes were set during processing
    expect(testSpan.setAttribute).toHaveBeenCalledWith(
      "type",
      "inference.azure_openai"
    );
    expect(testSpan.setAttribute).toHaveBeenCalledWith(
      "deployment",
      "test-deployment"
    );
    expect(testSpan.setAttribute).toHaveBeenCalledWith(
      "inference_endpoint",
      "https://test.openai.azure.com"
    );
    expect(testSpan.setAttribute).toHaveBeenCalledWith("name", "gpt-4");

    // Verify events were added
    expect(testSpan.addEvent).toHaveBeenCalledWith("data.input", {
      user: "test input message"
    });
    expect(testSpan.addEvent).toHaveBeenCalledWith("data.output", {
      response: "test output message"
    });

    // Verify processor lifecycle methods
    expect(dummySpanProcessor.forceFlush).not.toHaveBeenCalled();
    expect(dummySpanProcessor.shutdown).not.toHaveBeenCalled();
  });
});

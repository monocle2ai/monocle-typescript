import { setupMonocle } from "../instrumentation/common/instrumentation";
import { describe, expect, vi, beforeEach, test } from "vitest";

// Import the modules to mock
const resourceModule = await import("@opentelemetry/resources");
const asyncHooksModule = await import("@opentelemetry/context-async-hooks");
const nodeTracerModule = await import("@opentelemetry/sdk-trace-node");
const apiModule = await import("@opentelemetry/api");

// Create the mocks properly
vi.mock("@opentelemetry/resources", async () => {
  const actual = await vi.importActual("@opentelemetry/resources");
  return {
    ...actual,
    Resource: vi.fn().mockImplementation(() => ({
      attributes: { SERVICE_NAME: "test-workflow" }
    }))
  };
});
vi.mock("@opentelemetry/context-async-hooks");
vi.mock("@opentelemetry/sdk-trace-node");
vi.mock("@opentelemetry/api");

describe("setupMonocle", () => {
  let processedSpans;
  let dummySpanProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
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
      shutdown: vi.fn(),
      forceFlush: vi.fn()
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
    const addSpanProcessorMock = vi.fn((processor) => {
      registeredProcessor = processor;
    });
    vi.spyOn(
      nodeTracerModule.NodeTracerProvider.prototype,
      "addSpanProcessor"
    ).mockImplementation(addSpanProcessorMock);

    // Create specific mocks for methods that are verified
    const enableMock = vi.fn();
    vi.spyOn(
      asyncHooksModule.AsyncHooksContextManager.prototype,
      "enable"
    ).mockImplementation(enableMock);

    const setGlobalContextManagerMock = vi.fn();
    vi.spyOn(apiModule.context, "setGlobalContextManager").mockImplementation(
      setGlobalContextManagerMock
    );

    // Setup Monocle
    setupMonocle("test-workflow", [dummySpanProcessor], [dummyWrapperMethod]);

    // Verify basic setup
    expect(resourceModule.Resource).toHaveBeenCalledWith({
      SERVICE_NAME: "test-workflow"
    });
    expect(enableMock).toHaveBeenCalled();
    expect(setGlobalContextManagerMock).toHaveBeenCalled();
    expect(nodeTracerModule.NodeTracerProvider).toHaveBeenCalled();

    // Verify span processor registration
    expect(addSpanProcessorMock).toHaveBeenCalledWith(dummySpanProcessor);
    expect(registeredProcessor).toBe(dummySpanProcessor);

    // Create a test span
    const testSpan = {
      setAttribute: vi.fn(),
      addEvent: vi.fn(),
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

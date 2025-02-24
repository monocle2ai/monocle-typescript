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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should initialize with basic configuration", () => {
    // Create a dummy span processor
    const dummySpanProcessor = {
      _comment: "provider type ,name , deployment , inference_endpoint",
      attribute: "type",
      accessor: function ({ instance }) {
        if (
          instance?.constructor?.name?.toLowerCase().includes("azurechatopenai")
        ) {
          return "inference.azure_openai";
        }
        if (instance?.constructor?.name?.toLowerCase().includes("chatopenai")) {
          return "inference.openai";
        }
        return "";
      }
    };

    // Create a dummy wrapper method
    const dummyWrapperMethod = {
      package: "@langchain/core/runnables",
      object: "RunnableParallel",
      method: "invoke",
      spanName: "langchain.parallel"
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
  });
});

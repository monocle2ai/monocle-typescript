import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CustomConsoleSpanExporter } from "../common/custom_exporter";
import { OpenAI, OpenAIAgent } from "@llamaindex/openai";
import { Settings } from "llamaindex";
import { FunctionTool } from "llamaindex";
import { setupMonocle } from "../../dist";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import { backupEnvVars, clearEnvVars, restoreEnvVars, AZURE_OPENAI_ENV_VARS } from "../common/env_utils";

const COFFEE_MENU = {
  espresso: 2.5,
  latte: 3.5,
  cappuccino: 4.0,
  americano: 3.0
};

describe("LlamaIndex Agent Test", () => {
  const consoleSpy = vi.spyOn(console, "log");
  const capturedLogs: any[] = [];
  const customExporter = new CustomConsoleSpanExporter();
  let provider: NodeTracerProvider;
  let azureOpenAiBackup: Record<string, string | undefined>;

  beforeEach(() => {
    // Setup custom tracer provider with our exporter
    provider = new NodeTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(customExporter)      ],
    });
    provider.register();

    // Backup Azure OpenAI environment variables
    azureOpenAiBackup = backupEnvVars(AZURE_OPENAI_ENV_VARS);

    // Clear Azure OpenAI environment variables if OpenAI API key is present
    clearEnvVars(AZURE_OPENAI_ENV_VARS, !!process.env.OPENAI_API_KEY);

    // Now setup Monocle
    setupMonocle("llama_index_1");

    consoleSpy.mockImplementation((message) => {
      try {
        capturedLogs.push(JSON.parse(message));
      } catch (e) {
        console.warn("Found non json message in console log: ", message);
      }
    });
  });

  afterEach(async () => {
    // Force flush any pending spans before cleaning up
    if (provider) {
      await provider.forceFlush();
    }

    consoleSpy.mockReset();
    capturedLogs.length = 0;

    // Restore Azure OpenAI environment variables
    restoreEnvVars(azureOpenAiBackup);
  });

  it("should properly process coffee order and generate expected spans", async () => {
    // Import LlamaIndex components dynamically to avoid static import issues
    const getCoffeeMenu = (): string => {
      const menuStr = Object.entries(COFFEE_MENU)
        .map(([item, price]) => `${item}: $${price.toFixed(2)}`)
        .join("\n");
      return `Available coffee options:\n${menuStr}`;
    };

    const placeOrder = (coffeeType: string, quantity: number): string => {
      if (!(coffeeType.toLowerCase() in COFFEE_MENU)) {
        return `Sorry, ${coffeeType} is not available. Please choose from the menu.`;
      }
      const totalCost = COFFEE_MENU[coffeeType.toLowerCase()] * quantity;
      return `Your order for ${quantity} ${coffeeType}(s) is confirmed. Total cost: $${totalCost.toFixed(
        2
      )}`;
    };

    const coffeeMenuTool = FunctionTool.from(getCoffeeMenu, {
      name: "get_coffee_menu",
      description: "Provides a list of available coffee options with prices.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    });

    const orderTool = FunctionTool.from(placeOrder, {
      name: "place_order",
      description: "Places an order for coffee.",
      parameters: {
        type: "object",
        properties: {
          coffeeType: {
            type: "string",
            description: "The type of coffee to order"
          },
          quantity: {
            type: "number",
            description: "The number of coffees to order"
          }
        },
        required: ["coffeeType", "quantity"]
      }
    });

    // Initialize the OpenAI model as in the reference example
    const llm = new OpenAI({
      model: "gpt-4",
      temperature: 0
    });

    // Set the global LLM setting
    Settings.llm = llm;

    // Create the agent with the same LLM instance
    const agent = new OpenAIAgent({
      tools: [coffeeMenuTool, orderTool],
      llm: llm,
      systemPrompt: "You are a helpful coffee ordering assistant."
    });

    // Create a custom span to ensure tracing is working
    const tracer = trace.getTracer("test-tracer");
    const testSpan = tracer.startSpan("test-span");
    testSpan.setAttribute("test.attribute", "test-value");
    // Wrap the agent.chat call in a span to ensure it's tracked
    const parentSpan = tracer.startSpan("agent-chat");
    const userInput = "Please order 3 espresso coffees";
    try {
      const response = await agent.chat({ message: userInput });
      console.log(`Bot: ${response}`);
    } finally {
      parentSpan.end();
    }
    testSpan.end();
    await provider.forceFlush();

    // Wait for spans to be processed
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Get captured spans from the exporter
    const spans = customExporter.getCapturedSpans();

    // Check if we have spans to verify
    expect(spans.length).toBeGreaterThan(0);

    // Verify spans
    for (const span of spans) {
      const spanAttributes = span.attributes || {};

      if (spanAttributes["span.type"] === "inference") {
        // Assertions for all inference attributes
        expect(spanAttributes["entity.1.type"]).toBe("inference.azure_oai");
        expect(spanAttributes["entity.1.provider_name"]).toBeDefined();
        expect(spanAttributes["entity.1.inference_endpoint"]).toBeDefined();
        expect(spanAttributes["entity.2.name"]).toBe("gpt-4");
        expect(spanAttributes["entity.2.type"]).toBe("model.llm.gpt-4");

        // Assertions for metadata
        if (span.events && span.events.length >= 3) {
          const spanMetadata = span.events[2];
          expect(spanMetadata.attributes["completion_tokens"]).toBeDefined();
          expect(spanMetadata.attributes["prompt_tokens"]).toBeDefined();
          expect(spanMetadata.attributes["total_tokens"]).toBeDefined();
        }
      }

      if (spanAttributes["span.type"] === "agent") {
        // Assertions for all agent attributes
        expect(spanAttributes["entity.2.name"]).toBe("ReActAgent");
        expect(spanAttributes["entity.2.type"]).toBe("Agent.oai");
        expect(spanAttributes["entity.2.tools"]).toContain("place_order");
      }
    }
  });
}, 30000);

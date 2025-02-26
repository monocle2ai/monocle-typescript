import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { readFileSync } from "fs";
import { CustomConsoleSpanExporter } from "../common/custom_exporter";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OpenAI, OpenAIAgent } from "@llamaindex/openai";
import { setupMonocle } from "../../instrumentation/common/instrumentation";
import { FunctionTool } from "llamaindex";

// Define coffee menu
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

  beforeEach(() => {
    // Setup Monocle telemetry
    setupMonocle({
      workflowName: "llama_index_1",
      spanProcessors: [new BatchSpanProcessor(customExporter)],
      wrapperMethods: []
    });

    consoleSpy.mockImplementation((message) => {
      try {
        capturedLogs.push(JSON.parse(message));
      } catch (e) {
        console.warn("Found non json message in console log: ", message);
      }
    });
  });

  afterEach(() => {
    consoleSpy.mockReset();
    capturedLogs.length = 0;
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
      return `Your order for ${quantity} ${coffeeType}(s) is confirmed. Total cost: $${totalCost.toFixed(2)}`;
    };

    const coffeeMenuTool = FunctionTool.from(getCoffeeMenu, {
      name: "get_coffee_menu",
      description: "Provides a list of available coffee options with prices."
    });

    const orderTool = FunctionTool.from(placeOrder, {
      name: "place_order",
      description: "Places an order for coffee."
    });

    // Initialize LlamaIndex ReAct agent
    const llm = new OpenAI({
      model: "gpt-4",
      apiKey: process.env.OPENAI_API_KEY || ""
    });

    const agent = new OpenAIAgent({
      tools: [coffeeMenuTool, orderTool], // Include both tools
      llm: llm,
      systemPrompt: "You are a helpful coffee ordering assistant."
    });

    console.log("Welcome to the Coffee Bot! ");
    const userInput = "Please order 3 espresso coffees";

    const response = await agent.chat({ message: userInput });

    // Allow time for spans to be processed
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log(`Bot: ${response}`);

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
});

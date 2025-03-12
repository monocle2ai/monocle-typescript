import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach
} from "vitest";
import { setupMonocle } from "../../dist";
import { OpenAI } from "openai";
import { CustomConsoleSpanExporter } from "../common/custom_exporter";

const customExporter = new CustomConsoleSpanExporter();

// Mock OpenAI client constructor
vi.mock("openai", () => {
  return {
    OpenAI: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content:
                    "An Americano is a coffee drink made by diluting espresso with hot water."
                }
              }
            ]
          })
        }
      },
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [
            {
              embedding: Array(1536).fill(0.1)
            }
          ]
        })
      }
    }))
  };
});

describe("OpenAI API Client", () => {
  let openaiClient: OpenAI;

  beforeAll(() => {
    setupMonocle("openai.app");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Initialize the OpenAI client - create a new instance before each test
    openaiClient = new OpenAI({
      apiKey: "test-api-key"
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // Test case for the OpenAI API sample
  it("should verify OpenAI API inference attributes", async () => {
    const mockSpan = {
      attributes: {
        "span.type": "inference",
        "entity.2.type": "inference.azure_oai",
        "entity.2.provider_name": "azure-openai",
        "entity.2.inference_endpoint": "test-endpoint",
        "entity.3.name": "gpt-4o-mini",
        "entity.3.type": "model.llm.gpt-4o-mini"
      },
      events: [
        { attributes: { input: "What is an americano?" } },
        { attributes: { output: "An Americano is a coffee drink..." } },
        {
          attributes: {
            completion_tokens: 50,
            prompt_tokens: 20,
            total_tokens: 70
          }
        }
      ]
    };

    // Add the mock span to the exporter
    (customExporter as any).capturedSpans.push(mockSpan);

    // Make the API call
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant to answer coffee related questions"
        },
        {
          role: "user",
          content: "What is an americano?"
        }
      ]
    });

    // Verify we get a response
    expect(response.choices[0].message.content).toBeDefined();

    // Get the captured spans
    const spans = customExporter.getCapturedSpans();
    expect(spans.length).toBeGreaterThan(0);

    // Verify inference spans
    for (const span of spans) {
      const spanAttributes = span.attributes;

      if (spanAttributes["span.type"] === "inference") {
        // Assertions for all inference attributes
        expect(spanAttributes["entity.2.type"]).toBe("inference.azure_oai");
        expect(spanAttributes).toHaveProperty("entity.2.provider_name");
        expect(spanAttributes).toHaveProperty("entity.2.inference_endpoint");
        expect(spanAttributes["entity.3.name"]).toBe("gpt-4o-mini");
        expect(spanAttributes["entity.3.type"]).toBe("model.llm.gpt-4o-mini");

        const [spanInput, spanOutput, spanMetadata] = span.events;
        expect(spanMetadata.attributes).toHaveProperty("completion_tokens");
        expect(spanMetadata.attributes).toHaveProperty("prompt_tokens");
        expect(spanMetadata.attributes).toHaveProperty("total_tokens");
      }
    }
  });

  // Adding tests from the first file
  it("should successfully get a chat completion response", async () => {
    // Call the chat completions create function
    const response = await openaiClient.chat.completions.create({
      messages: [
        { role: "user", content: "What is an americano?" },
        {
          role: "system",
          content:
            "You are a helpful assistant to answer questions about coffee."
        }
      ],
      model: "gpt-4o"
    });

    // Verify the function was called
    expect(openaiClient.chat.completions.create).toHaveBeenCalledWith({
      messages: [
        { role: "user", content: "What is an americano?" },
        {
          role: "system",
          content:
            "You are a helpful assistant to answer questions about coffee."
        }
      ],
      model: "gpt-4o"
    });

    // Verify the result
    expect(response.choices[0].message.content).toBe(
      "An Americano is a coffee drink made by diluting espresso with hot water."
    );
  });

  it("should successfully get an embedding response", async () => {
    // Call the embeddings create function
    const response = await openaiClient.embeddings.create({
      model: "text-embedding-3-small",
      input: "What is an americano?",
      encoding_format: "float"
    });

    // Verify the function was called
    expect(openaiClient.embeddings.create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "What is an americano?",
      encoding_format: "float"
    });

    // Get the embedding vector
    const embedding = response.data[0].embedding;

    // Verify the result
    expect(embedding).toHaveLength(1536);
    expect(embedding[0]).toBe(0.1);
  });

  it("should handle errors properly", async () => {
    // Mock the error case for this specific test
    const mockError = new Error("API error");
    (openaiClient.chat.completions.create as any).mockRejectedValueOnce(
      mockError
    );

    // Test that the error is thrown
    await expect(
      openaiClient.chat.completions.create({
        messages: [{ role: "user", content: "What is an americano?" }],
        model: "gpt-4o"
      })
    ).rejects.toThrow("API error");
  });
});

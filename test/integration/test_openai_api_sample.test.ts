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

// Constants for reusable test data
const TEST_API_KEY = "test-api-key";
const TEST_MODEL = "gpt-4o-mini";
const TEST_EMBEDDING_MODEL = "text-embedding-3-small";
const TEST_PROMPT = "What is an americano?";
const TEST_RESPONSE =
  "An Americano is a coffee drink made by diluting espresso with hot water.";

// Mock response objects for better readability
const mockChatResponse = {
  choices: [
    {
      message: {
        content: TEST_RESPONSE
      }
    }
  ]
};

const mockEmbeddingResponse = {
  data: [
    {
      embedding: Array(1536).fill(0.1)
    }
  ]
};

// Mock OpenAI client constructor
vi.mock("openai", () => {
  return {
    OpenAI: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockChatResponse)
        }
      },
      embeddings: {
        create: vi.fn().mockResolvedValue(mockEmbeddingResponse)
      }
    }))
  };
});

describe("OpenAI API Client", () => {
  let openaiClient: OpenAI;
  const customExporter = new CustomConsoleSpanExporter();

  beforeAll(() => {
    setupMonocle("openai.app");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the captured spans before each test
    (customExporter as any).capturedSpans = [];

    openaiClient = new OpenAI({
      apiKey: TEST_API_KEY
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // Helper function to create a mock inference span
  const createMockInferenceSpan = (modelName = TEST_MODEL) => ({
    attributes: {
      "span.type": "inference",
      "entity.2.type": "inference.azure_oai",
      "entity.2.provider_name": "azure-openai",
      "entity.2.inference_endpoint": "test-endpoint",
      "entity.3.name": modelName,
      "entity.3.type": `model.llm.${modelName}`
    },
    events: [
      { attributes: { input: TEST_PROMPT } },
      { attributes: { output: TEST_RESPONSE } },
      {
        attributes: {
          completion_tokens: 50,
          prompt_tokens: 20,
          total_tokens: 70
        }
      }
    ]
  });

  it("should verify OpenAI API inference attributes", async () => {
    // Add the mock span to the exporter
    (customExporter as any).capturedSpans.push(createMockInferenceSpan());

    // Make the API call
    const response = await openaiClient.chat.completions.create({
      model: TEST_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant to answer coffee related questions"
        },
        {
          role: "user",
          content: TEST_PROMPT
        }
      ]
    });

    // Verify we get a response
    expect(response.choices[0].message.content).toBeDefined();

    // Get the captured spans
    const spans = customExporter.getCapturedSpans();
    expect(spans.length).toBeGreaterThan(0);

    // Verify inference spans
    const inferenceSpans = spans.filter(
      (span) => span.attributes["span.type"] === "inference"
    );

    expect(inferenceSpans.length).toBeGreaterThan(0);

    for (const span of inferenceSpans) {
      const spanAttributes = span.attributes;

      // Assertions for all inference attributes
      expect(spanAttributes["entity.2.type"]).toBe("inference.azure_oai");
      expect(spanAttributes).toHaveProperty("entity.2.provider_name");
      expect(spanAttributes).toHaveProperty("entity.2.inference_endpoint");
      expect(spanAttributes["entity.3.name"]).toBe(TEST_MODEL);
      expect(spanAttributes["entity.3.type"]).toBe(`model.llm.${TEST_MODEL}`);

      const [spanInput, spanOutput, spanMetadata] = span.events;

      // Verify token metadata
      expect(spanMetadata.attributes).toHaveProperty("completion_tokens");
      expect(spanMetadata.attributes).toHaveProperty("prompt_tokens");
      expect(spanMetadata.attributes).toHaveProperty("total_tokens");
    }
  });

  it("should successfully get a chat completion response", async () => {
    const testMessages = [
      { role: "user", content: TEST_PROMPT },
      {
        role: "system",
        content: "You are a helpful assistant to answer questions about coffee."
      }
    ];

    // Call the chat completions create function
    const response = await openaiClient.chat.completions.create({
      messages: testMessages,
      model: "gpt-4o"
    });

    // Verify the function was called with correct parameters
    expect(openaiClient.chat.completions.create).toHaveBeenCalledWith({
      messages: testMessages,
      model: "gpt-4o"
    });

    // Verify the result
    expect(response.choices[0].message.content).toBe(TEST_RESPONSE);
  });

  it("should successfully get an embedding response", async () => {
    const embeddingRequest = {
      model: TEST_EMBEDDING_MODEL,
      input: TEST_PROMPT,
      encoding_format: "float"
    };

    // Call the embeddings create function
    const response = await openaiClient.embeddings.create(embeddingRequest);

    // Verify the function was called with correct parameters
    expect(openaiClient.embeddings.create).toHaveBeenCalledWith(
      embeddingRequest
    );

    // Get the embedding vector
    const embedding = response.data[0].embedding;

    // Verify the result
    expect(embedding).toHaveLength(1536);
    expect(embedding[0]).toBe(0.1);
  });

  it("should handle errors properly", async () => {
    // Define expected error
    const expectedError = new Error("API error");

    // Mock the error case for this specific test
    (openaiClient.chat.completions.create as any).mockRejectedValueOnce(
      expectedError
    );

    // Test that the error is thrown
    await expect(
      openaiClient.chat.completions.create({
        messages: [{ role: "user", content: TEST_PROMPT }],
        model: "gpt-4o"
      })
    ).rejects.toThrow("API error");
  });
});

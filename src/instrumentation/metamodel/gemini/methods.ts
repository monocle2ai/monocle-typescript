import { config as inferenceConfig } from "./entities/inference";
import { config as embeddingConfig } from "./entities/embedding";

export const config = [
  {
    package: "@google/genai",
    object: "Models",
    method: "generateContentInternal",
    spanName: "gemini.generate_content",
    output_processor: [inferenceConfig],
  },
  {
    package: "@google/genai",
    object: "Models",
    method: "embedContent",
    spanName: "gemini.embed_content",
    output_processor: [embeddingConfig],
  },
];

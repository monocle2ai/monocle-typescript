import { config as inferenceConfig } from "./entities/inference";

export const config = [
  {
    package: "@google/genai",
    object: "Models",
    method: "generateContentInternal",
    spanName: "gemini.generate_content",
    output_processor: [inferenceConfig],
  },
];

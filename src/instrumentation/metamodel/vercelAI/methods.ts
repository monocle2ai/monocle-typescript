import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { config as inferenceConfig } from "./entities/inference.js";

export const config = [
  {
    package: "ai",
    object: "",
    method: "generateText",
    spanName: "vercelAI.generateText",
    output_processor: [inferenceConfig],
    spanHandler: new NonFrameworkSpanHandler()
  }
];

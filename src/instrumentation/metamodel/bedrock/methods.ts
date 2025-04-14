import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { config as inferenceConfig } from "./entities/inference.js";

export const config = [
  {
    package: "@aws-sdk/client-bedrock-runtime",
    object: "BedrockRuntimeClient",
    method: "send",
    spanName: "aws_bedrock_invoke_model",
    output_processor: [inferenceConfig],
    spanHandler: new NonFrameworkSpanHandler()
  }
];

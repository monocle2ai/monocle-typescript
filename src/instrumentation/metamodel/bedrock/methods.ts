import { NonFrameworkSpanHandler } from "../../common/spanHandler";

export const config = [
  {
    package: "@aws-sdk/client-bedrock-runtime",
    object: "BedrockRuntimeClient",
    method: "send",
    spanName: "aws_bedrock_invoke_model",
    output_processor: [require("./entities/inference.js").config],
    spanHandler: new NonFrameworkSpanHandler()
  }
];

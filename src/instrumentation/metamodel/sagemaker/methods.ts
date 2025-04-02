import { NonFrameworkSpanHandler } from "../../common/spanHandler";

export const config = [
  {
    package: "@aws-sdk/client-sagemaker-runtime",
    object: "SageMakerRuntimeClient",
    method: "send",
    spanName: "aws_sagemaker_invoke_endpoint",
    output_processor: [require("./entities/inference.js").config],
    spanHandler: new NonFrameworkSpanHandler()
  }
];

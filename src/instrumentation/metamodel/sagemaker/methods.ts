import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { config as inferenceConfig } from "./entities/inference";

export const config = [
  {
    package: "@aws-sdk/client-sagemaker-runtime",
    object: "SageMakerRuntimeClient",
    method: "send",
    spanName: "aws_sagemaker_invoke_endpoint",
    output_processor: [inferenceConfig],
    spanHandler: new NonFrameworkSpanHandler()
  }
];

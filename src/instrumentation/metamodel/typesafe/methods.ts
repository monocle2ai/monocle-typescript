import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { config as inferenceConfig } from "./entities/inference";

export const config = [
  {
    package: "@typesafe-ai/sdk",
    object: "TypeSafeClient",
    method: "systemOne",
    spanName: "typesafe.system_one",
    output_processor: [inferenceConfig],
    spanHandler: new NonFrameworkSpanHandler()
  }
];

import { NonFrameworkSpanHandler } from "../../common/spanHandler";

export const config = [
  {
    package: "ai",
    object: "",
    method: "generateText",
    spanName: "vercelAI.generateText",
    output_processor: [require("./entities/inference.js").config],
    spanHandler: new NonFrameworkSpanHandler()
  }
];

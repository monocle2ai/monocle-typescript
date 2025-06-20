import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { config as httpRequestOutputConfig } from "./entities/httpRequest";

export const config = [
  {
    package: "next/dist/server/base-server",
    object: "default",
    method: "handleRequest",
    spanName: "nextjs.api.handler",
    output_processor: [httpRequestOutputConfig],
    spanHandler: new NonFrameworkSpanHandler(),
  },
];
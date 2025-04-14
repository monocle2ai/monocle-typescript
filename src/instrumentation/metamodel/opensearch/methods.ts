import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { config as retrievalConfig } from "./entities/retrieval.js";

export const config = [
  {
    package: "@opensearch-project/opensearch",
    object: "Client",
    method: "search",
    spanName: "opensearch_search",
    output_processor: [retrievalConfig],
    spanHandler: new NonFrameworkSpanHandler()
  }
];

import { NonFrameworkSpanHandler } from "../../common/spanHandler";

export const config = [
  {
    package: "@opensearch-project/opensearch",
    object: "Client",
    method: "search",
    spanName: "opensearch_search",
    output_processor: [require("./entities/retrieval.js").config],
    spanHandler: new NonFrameworkSpanHandler()
  }
];

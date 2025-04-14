import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { config as inferenceConfig } from "./entities/inference.js";
import { config as retrievalConfig } from "./entities/retrieval.js";

export const config = [
    {
        package: "openai/resources/chat/completions",
        object: "Completions",
        method: "create",
        spanName: "openai_chat",
        output_processor: [inferenceConfig],
        spanHandler: new NonFrameworkSpanHandler()
    },
    {
        package: "openai/resources/embeddings",
        object: "Embeddings",
        method: "create",
        spanName: "openai_embeddings",
        output_processor: [retrievalConfig],
        spanHandler: new NonFrameworkSpanHandler()
    },
    {
        package: "openai/resources/responses/responses",
        object: "Responses",
        method: "create",
        spanName: "openai_responses",
        output_processor: [inferenceConfig],
        spanHandler: new NonFrameworkSpanHandler(),
    },
    {
        package: "openai/resources/responses/responses",
        object: "AsyncResponses",
        method: "create",
        spanName: "openai_async_responses",
        output_processor: [retrievalConfig],
        spanHandler: new NonFrameworkSpanHandler(),
    },

];
import { config as inferenceConfig, OpenAISpanHandler } from "./entities/inference";
import { config as retrievalConfig } from "./entities/retrieval";

export const config = [
    {
        package: "openai/resources/chat/completions",
        object: "Completions",
        method: "create",
        spanName: "openai.chat",
        output_processor: [inferenceConfig],
        spanHandler: new OpenAISpanHandler()
    },
    {
        package: "openai/resources/embeddings",
        object: "Embeddings",
        method: "create",
        spanName: "openai.embeddings",
        output_processor: [retrievalConfig],
        spanHandler: new OpenAISpanHandler()
    },
    {
        package: "openai/resources/responses/responses",
        object: "Responses",
        method: "create",
        spanName: "openai.responses",
        output_processor: [inferenceConfig],
        spanHandler: new OpenAISpanHandler(),
    },
    {
        package: "openai/resources/responses/responses",
        object: "Responses",
        method: "stream",
        spanName: "openai.responses.stream",
        output_processor: [inferenceConfig],
        spanHandler: new OpenAISpanHandler(),
    }

];
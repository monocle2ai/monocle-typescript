import { NonFrameworkSpanHandler } from "../../common/spanHandler";

export const config = [
    {
        package: "openai/resources/chat/completions",
        object: "Completions",
        method: "create",
        spanName: "openai_chat",
        output_processor: [require("./entities/inference.js").config],
        spanHandler: new NonFrameworkSpanHandler()
    },
    {
        package: "openai/resources/embeddings",
        object: "Embeddings",
        method: "create",
        spanName: "openai_embeddings",
        output_processor: [require("./entities/retrieval.js").config],
        spanHandler: new NonFrameworkSpanHandler()
    }
];
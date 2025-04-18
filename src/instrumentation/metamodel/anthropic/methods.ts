import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { config as inferenceConfig } from "./entities/inference";

export const config = [
    {
        package: "@anthropic-ai/sdk/resources/messages/messages",
        object: "Messages",
        method: "create",
        spanName: "anthropic.messages.create",
        output_processor: [inferenceConfig],
        spanHandler: new NonFrameworkSpanHandler()
        

    },
    {
        package: "@anthropic-ai/sdk/resources/messages/messages",
        object: "Messages",
        method: "stream",
        spanName: "anthropic.messages.stream",
        output_processor: [inferenceConfig],
        spanHandler: new NonFrameworkSpanHandler()


    },
];

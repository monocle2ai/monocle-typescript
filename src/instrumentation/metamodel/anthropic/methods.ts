export const config = [
    {
        package: "@anthropic-ai/sdk/resources/messages",
        object: "Messages",
        method: "create",
        spanName: "anthropic.messages.create",
        output_processor: [require("./entities/inference.js").config]

    },
    {
        package: "@anthropic-ai/sdk/resources/messages/messages",
        object: "Messages",
        method: "create",
        spanName: "anthropic.messages.create",
        output_processor: [require("./entities/inference.js").config]

    },
    {
        package: "@anthropic-ai/sdk/resources/messages",
        object: "Messages",
        method: "stream",
        spanName: "anthropic.messages.stream",
        output_processor: [require("./entities/inference.js").config]

    },
    {
        package: "@anthropic-ai/sdk/resources/messages/messages",
        object: "Messages",
        method: "stream",
        spanName: "anthropic.messages.stream",
        output_processor: [require("./entities/inference.js").config]

    },
];

export const config = [
  {
    package: "openai/resources/chat/completions",
    object: "Completions",
    method: "create",
    output_processor: [require("./entities/inference.js").config]
  }
];

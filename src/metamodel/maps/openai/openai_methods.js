exports.config = [
    {
        "package": "openai/resources/chat/completions",
        "object": "Completions",
        "method": "create",
        "output_processor": [
            require("./openai_attributes.js").config
        ]
    }
]
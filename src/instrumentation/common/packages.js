const langchainPackages = require("../metamodel/langchain/methods").config
const llamaindexPackages = require("../metamodel/llamaindex/methods").config
const openaiPackages = require("../metamodel/openai/methods").config

exports.combinedPackages = [
    ...langchainPackages,
    ...llamaindexPackages,
    ...openaiPackages
]
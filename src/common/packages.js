const langchainPackages = require("../metamodel/maps/langchain/langchain_methods").config
const llamaindexPackages = require("../metamodel/maps/llamaindex/llamaindex_methods").config
const openaiPackages = require("../metamodel/maps/openai/openai_methods").config

exports.combinedPackages = [
    ...langchainPackages,
    ...llamaindexPackages,
    ...openaiPackages
]
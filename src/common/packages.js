const langchainPackages = require("../metamodel/maps/langchain_methods").config
const llamaindexPackages = require("../metamodel/maps/llamaindex_methods").config
const openaiPackages = require("../metamodel/maps/openai_methods").config

exports.combinedPackages = [
    ...langchainPackages,
    ...llamaindexPackages,
    ...openaiPackages
]
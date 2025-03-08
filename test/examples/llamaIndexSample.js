const { setupMonocle } = require("../../dist")

setupMonocle(
  "llamaindex.app"
)

const {
  Document,
  MetadataMode,
  VectorStoreIndex,
} = require("llamaindex")

async function main() {
  // Load essay from abramov.txt in Node

  const essay = "Coffee is a beverage brewed from roasted, ground coffee beans.";

  // Create Document object with essay
  const document = new Document({ text: essay, id_: "coffee_text" });

  // Split text and create embeddings. Store them in a VectorStoreIndex
  const index = await VectorStoreIndex.fromDocuments([document]);

  // Query the index
  const queryEngine = index.asQueryEngine();
  const { response, sourceNodes } = await queryEngine.query({
    query: "What is coffee?",
  });

  // Output response with sources
  console.debug(response);

  if (sourceNodes) {
    sourceNodes.forEach((source, index) => {
      console.debug(
        `\n${index}: Score: ${source.score} - ${source.node.getContent(MetadataMode.NONE).substring(0, 50)}...\n`,
      );
     
    });
  }

}

main().catch(console.error);
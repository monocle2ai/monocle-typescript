const { setupMonocle, setScopes, setScopesBind } = require("../../dist");
setupMonocle("langchain.app");

const { ChatOpenAI, OpenAIEmbeddings } = require("@langchain/openai");
const { formatDocumentsAsString } = require("langchain/util/document");
const { PromptTemplate } = require("@langchain/core/prompts");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const {
  RunnableSequence,
  RunnablePassthrough,
} = require("@langchain/core/runnables");
const { StringOutputParser } = require("@langchain/core/output_parsers");


let langchainInvoke = async (msg, model) => {
  const text = "Coffee is a beverage brewed from roasted, ground coffee beans."
  const vectorStore = await MemoryVectorStore.fromTexts(
    [text],
    [{ id: 1 }],
    new OpenAIEmbeddings()
  )
  const retriever = vectorStore.asRetriever();

  const prompt =
    PromptTemplate.fromTemplate(`Answer the question based only on the following context:
{context} .
If you don't know the answer, you can say "I don't know".

Question: {question}`);

  const chain = RunnableSequence.from([
    {
      context: retriever.pipe(formatDocumentsAsString),
      question: new RunnablePassthrough(),
    },
    prompt,
    model,
    new StringOutputParser(),
  ]);

  // set scope for invoking the chain
  const res = await setScopes({ "langchain.scope_test": "1" }, () => {
    return chain.invoke(msg)
  })
  return res;
}

// bind the whole function with a scope
langchainInvoke = setScopesBind({
  "langchain.scope_bind_test": "1"
}, langchainInvoke);

// Only run if this file is being executed directly (not imported)

async function main() {

  try {
    const validModel = new ChatOpenAI({});

    // INVALID API key client
    const invalidModel = new ChatOpenAI({
      openAIApiKey: "INVALID_KEY",
    });

    await langchainInvoke("What is coffee?", validModel);
    await langchainInvoke("What is coffee?", invalidModel);
  } catch (e) {
    console.error("Error during langchainInvoke:", e);
  }
}

if (require.main === module) {
  (async () => {
      try {
        await main();
      } catch (e) {
        console.error("Error during processing:", e);
      }
      // Wait 5 seconds then exit
      setTimeout(() => {
        console.log("Exiting after 5 seconds...");
        process.exit(0); // force clean exit
      }, 5_000);
    })();
}

module.exports = { main };
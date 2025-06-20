import { setupMonocle, setScopes, setScopesBind } from "../../dist";
setupMonocle(
    "langchain.app"
)

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { formatDocumentsAsString } from "langchain/util/document";
import { PromptTemplate } from "@langchain/core/prompts";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import {
    RunnableSequence,
    RunnablePassthrough,
} from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

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
}, langchainInvoke) as any;

// Only run if this file is being executed directly (not imported)
if (require.main === module) {
  (async () => {
    try {
      const validModel = new ChatOpenAI({});

      // INVALID API key client
      const invalidModel = new ChatOpenAI({
        openAIApiKey: "INVALID_KEY",
      });

      await langchainInvoke("What is coffee?",validModel);
      await langchainInvoke("What is coffee?", invalidModel);
    } catch (e) {
      console.error("Error during langchainInvoke:", e);
    }

    // Wait 5 seconds then exit
    setTimeout(() => {
      console.log("Exiting after 5 seconds...");
      process.exit(0); // force clean exit
    }, 5_000);
  })();
}

export { langchainInvoke };

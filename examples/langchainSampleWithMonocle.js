const { setupMonocle } = require("../dist");

setupMonocle("langchain.app");

const { ChatOpenAI, OpenAIEmbeddings } = require("@langchain/openai");
const { formatDocumentsAsString } = require("langchain/util/document");
const { PromptTemplate } = require("@langchain/core/prompts");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");

const {
  RunnableSequence,
  RunnablePassthrough
} = require("@langchain/core/runnables");
const { StringOutputParser } = require("@langchain/core/output_parsers");

const langchainInvoke = async (msg) => {
  const model = new ChatOpenAI({});
  const text = "Coffee is a beverage brewed from roasted, ground coffee beans.";
  const vectorStore = await MemoryVectorStore.fromTexts(
    [text],
    [{ id: 1 }],
    new OpenAIEmbeddings()
  );
  const retriever = vectorStore.asRetriever();

  const prompt =
    PromptTemplate.fromTemplate(`Answer the question based only on the following context:
{context} .
If you don't know the answer, you can say "I don't know".

Question: {question}`);

  const chain = RunnableSequence.from([
    {
      context: retriever.pipe(formatDocumentsAsString),
      question: new RunnablePassthrough()
    },
    prompt,
    model,
    new StringOutputParser()
  ]);

  const res = await chain.invoke(msg);
  return res;
};

langchainInvoke("What is coffee?").then(console.log);

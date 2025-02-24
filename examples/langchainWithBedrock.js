const { setupMonocle } = require("../dist");

setupMonocle("langchainBedrock.app");

const { formatDocumentsAsString } = require("langchain/util/document");
const { OpenAIEmbeddings } = require("@langchain/openai");
const { PromptTemplate } = require("@langchain/core/prompts");
const { BedrockChat } = require("@langchain/community/chat_models/bedrock");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const {
  RunnableSequence,
  RunnablePassthrough
} = require("@langchain/core/runnables");
const { StringOutputParser } = require("@langchain/core/output_parsers");

const langchainInvoke = async (msg) => {
  const model = new BedrockChat({
    model: "anthropic.claude-v2",
    region: "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  const embeddings = new OpenAIEmbeddings();
  const text = "Coffee is a beverage brewed from roasted, ground coffee beans.";
  const vectorStore = await MemoryVectorStore.fromTexts(
    [text],
    [{ id: 1 }],
    embeddings
  );
  const retriever = vectorStore?.asRetriever();

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

langchainInvoke("what is coffee").then(console.log);

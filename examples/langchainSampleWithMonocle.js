
const { setupMonocle } = require("../dist")

setupMonocle(
  "langchain.app"
)

const { ChatOpenAI, OpenAIEmbeddings } = require("@langchain/openai")
const { HNSWLib } = require("@langchain/community/vectorstores/hnswlib")
const { formatDocumentsAsString } = require("langchain/util/document");
const { PromptTemplate } = require("@langchain/core/prompts");
const {
  RunnableSequence,
  RunnablePassthrough,
} = require("@langchain/core/runnables");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const fs = require("fs")

const model = new ChatOpenAI({});
const text = fs.readFileSync('./text.txt', 'utf8')
HNSWLib.fromTexts(
  [text],
  [{ id: 1 }],
  new OpenAIEmbeddings()
).then((vectorStore) => {
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

  chain.invoke("What is coffee?").then(
    (res) => {
      console.log("result:" + res)
    }
  ).finally(() => {
    
  })



  //console.log(result);
})
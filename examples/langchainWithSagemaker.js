require("dotenv").config({ path: "../.env" });

const { setupMonocle } = require("monocle2ai");

setupMonocle("langchain.app");

const { OpenAIEmbeddings } = require("@langchain/openai");
const { formatDocumentsAsString } = require("langchain/util/document");
const { PromptTemplate } = require("@langchain/core/prompts");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");

const {
  RunnableSequence,
  RunnablePassthrough
} = require("@langchain/core/runnables");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const AWS = require("aws-sdk");

const getSageMakerResponse = async (inputText) => {
  let sagemaker = new AWS.SageMakerRuntime({
    apiVersion: "2017-07-24",
    region: "us-east-1",
    credentials: new AWS.Credentials(
      process.env.AWS_ACCESS_KEY_ID,
      process.env.AWS_SECRET_ACCESS_KEY,
      null
    )
  });
  const inputData = {
    question: "What is coffee?",
    context: inputText
  };
  const params = {
    EndpointName: "okahu-sagemaker-rag-qa-ep",
    Body: JSON.stringify(inputData),
    ContentType: "application/json"
  };

  try {
    const data = await sagemaker.invokeEndpoint(params).promise();
    const responseBody = JSON.parse(Buffer.from(data.Body).toString("utf8"));
    return responseBody.answer;
  } catch (err) {
    console.error("Error invoking SageMaker endpoint:", err);
    throw err;
  }
};

const langchainInvoke = async (msg) => {
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

  const chain = RunnableSequence.from(
    [
      {
        context: retriever.pipe(formatDocumentsAsString),
        question: new RunnablePassthrough()
      },
      prompt,
      async ({ context, question }) => {
        const inputText = `Context: ${context}\nQuestion: ${question}`;
        const sageMakerResponse = await getSageMakerResponse(inputText);
        return sageMakerResponse;
      },
      new StringOutputParser()
    ],
    ["context", "question"]
  );
  const res = await chain.invoke(msg);
  return res;
};

langchainInvoke("What is coffee?").then(console.log).catch(console.error);

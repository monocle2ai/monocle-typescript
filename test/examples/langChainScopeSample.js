const { setupMonocle, attachHeadersScopes } = require("../../dist");
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

// Example request headers
const requestHeaders = {
  "x-request-id": "test-123",
  "x-session-id": "session-456",
  "x-correlation-id": "corr-789",
  "user-agent": "langchain-test",
};

let langchainInvoke = async (msg) => {
  const model = new ChatOpenAI({});
  // ...existing setup code...
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
      question: new RunnablePassthrough(),
    },
    prompt,
    model,
    new StringOutputParser(),
  ]);

  // set scope for invoking the chain

  // Using attachHeadersScopes with request headers
  const res = await attachHeadersScopes(requestHeaders, async () => {
    const result = await chain.invoke(msg);
    console.log("Headers attached to context:", requestHeaders);
    return result;
  });
  return res;
};

// Test different header combinations
async function testWithDifferentHeaders() {
  console.log("Testing with different header combinations:");

  // Test 1: With tracking headers
  const trackingHeaders = {
    "x-request-id": "req-abc",
    "x-trace-id": "trace-123",
  };
  console.log("\nTest 1 - With tracking headers:");
  await attachHeadersScopes(trackingHeaders, async () => {
    const result = await langchainInvoke("What is coffee?");
    console.log("Result:", result);
  });

  // Test 2: With authentication headers
  const authHeaders = {
    authorization: "Bearer test-token",
    "x-api-key": "test-api-key",
  };
  console.log("\nTest 2 - With auth headers:");
  await attachHeadersScopes(authHeaders, async () => {
    const result = await langchainInvoke("What is coffee?");
    console.log("Result:", result);
  });

  // Test 3: Nested header scopes
  console.log("\nTest 3 - Nested header scopes:");
  await attachHeadersScopes(trackingHeaders, async () => {
    await attachHeadersScopes(authHeaders, async () => {
      const result = await langchainInvoke("What is coffee?");
      console.log("Result:", result);
    });
  });
}

// Only run if this file is being executed directly
if (require.main === module) {
  testWithDifferentHeaders().catch(console.error);
}

module.exports = {
  langchainInvoke,
  testWithDifferentHeaders,
};

// const { RunnableBranch, StrOutputParser } = require("@langchain/core");
import { BaseLanguageModelInterface } from "@langchain/core/language_models/base";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { BasePromptTemplate } from "@langchain/core/prompts";
import { BaseRetriever } from "@langchain/core/retrievers";
import { RunnableBranch } from "@langchain/core/runnables";

/**
 * Create a chain that takes conversation history and returns documents.
 *
 * If there is no `chat_history`, then the `input` is just passed directly to the
 * retriever. If there is `chat_history`, then the prompt and LLM will be used
 * to generate a search query. That search query is then passed to the retriever.
 *
 * @param llm Language model to use for generating a search term given chat history
 * @param retriever RetrieverLike object that takes a string as input and outputs
 *                  a list of Documents.
 * @param prompt The prompt used to generate the search query for the retriever.
 * @returns An LCEL Runnable that handles chat history for retrieval
 */
export function createHistoryAwareRetriever(
  llm: BaseLanguageModelInterface,
  retriever: BaseRetriever,
  prompt: BasePromptTemplate
) {
  if (!prompt.inputVariables.includes("input")) {
    throw new Error(
      `Expected 'input' to be a prompt variable, but got ${prompt.inputVariables}`
    );
  }

  const retrieveDocuments = RunnableBranch.from([
    [
      // Both empty string and empty list evaluate to false
      (x: { chat_history?: any; input: string }) =>
        !x.chat_history ||
        (Array.isArray(x.chat_history) && x.chat_history.length === 0),
      // If no chat history, then we just pass input to retriever
      (x: { input: string }) => retriever.invoke(x.input)
    ],
    // If chat history, then we pass inputs to LLM chain, then to retriever
    prompt.pipe(llm).pipe(new StringOutputParser()).pipe(retriever)
  ]).withConfig({ runName: "chat_retriever_chain" });

  return retrieveDocuments;
}

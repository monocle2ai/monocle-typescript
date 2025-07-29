import { config as inferenceConfig } from "./entities/agent";

export const config = [
  {
    package: "@langchain/langgraph",
    object: "CompiledStateGraph",
    method: "invoke",
    spanName: "langgraph.agent.invoke",
    spanType: "workflow",
    output_processor: [inferenceConfig],
  },
];
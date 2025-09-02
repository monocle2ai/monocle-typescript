import { config as clientConfig } from "./entities/client";

export const config = [
  {
    package: "@a2a-js/sdk/client",
    object: "A2AClient",
    method: "sendMessage",
    spanName: "a2a.send_message",
    output_processor: [clientConfig],
  },
  // {
  //   package: "@a2a-js/sdk/client",
  //   object: "A2AClient",
  //   method: "getTask",
  //   spanName: "a2a.get_task",
  //   output_processor: [capabilityConfig],
  // }
];
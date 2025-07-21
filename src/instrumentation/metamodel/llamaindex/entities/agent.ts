import { getExceptionMessage, getStatus, getStatusCode } from "../../utils";

export const config = {
  type: "agent",
  attributes: [
    [
      {
        attribute: "type",
        accessor: function () {
          return `agent.oai`;
        },
      },
      {
        _comment: "name of the agent",
        attribute: "name",
        accessor: function ({ instance }) {
          return (
            instance?.name || instance?.constructor?.name || "llamaindex_agent"
          );
        },
      },
      {
        attribute: "tools",
        accessor: function ({ instance }) {
            
          // Handle AgentWorkflow structure
          if (instance?.agents && instance.agents instanceof Map) {
            const allTools = [];
            for (const [_, agent] of instance.agents) {
              if (agent?.tools && Array.isArray(agent.tools)) {
                allTools.push(
                  ...agent.tools.map(
                    (tool) => tool?.metadata?.name || tool?.name || "unknown"
                  )
                );
              }
            }
            return allTools;
          }

          // Handle direct tools array (for other agent types)
          if (instance?.tools && Array.isArray(instance.tools)) {
            return instance.tools.map(
              (tool) => tool?.metadata?.name || tool?.name || "unknown"
            );
          }

          return [];
        },
      },
    ],
  ],
  events: [
    {
      name: "data.input",
      attributes: [
        {
          _comment: "User input to the agent",
          attribute: "input",
          accessor: function ({ args }) {
            if (args?.[0]?.message) {
              return args[0].message;
            }
            if (typeof args?.[0] === "string") {
              return args[0];
            }
            return JSON.stringify(args?.[0] || "");
          },
        },
      ],
    },
    {
      name: "data.output",
      attributes: [
        {
          _comment: "Agent response",
          attribute: "response",
          accessor: function ({ response, exception }) {
            if (exception) {
              return getExceptionMessage({ exception });
            }
            // Handle StopEvent format from AgentWorkflow
            if (response?.data?.result) {
              return response.data.result;
            }

            // Handle other response formats
            if (response?.response?.message?.content) {
              return response.response.message.content;
            }
            if (response?.message?.content) {
              return response.message.content;
            }
            if (response?.content) {
              return response.content;
            }
            if (typeof response === "string") {
              return response;
            }
            return JSON.stringify(response || "");
          },
        },
        {
          attribute: "status",
          accessor: (args) => {
            return getStatus(args);
          },
        },
        {
          attribute: "status_code",
          accessor: (args) => {
            return getStatusCode(args);
          },
        },
      ],
    },
  ],
};

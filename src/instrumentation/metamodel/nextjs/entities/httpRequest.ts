export const config = {
  type: "nextjs",
  attributes: [
    [
      {
        attribute: "route",
        accessor: function ({ args }) {
          return args[0]?.url || args[0]?._req?.url || "";
        },
      },
      {
        attribute: "method",
        accessor: function ({ args }) {
          return args[0]?.method || "";
        },
      },
    ],
  ],
  events: [
    {
      name: "data.input",
      attributes: [
        {
          attribute: "input",
          accessor: function ({ args }) {
            return args[0]?.url || "";
          },
        },
      ],
    },
    {
      name: "data.output",
      attributes: [
        {
          attribute: "status_code",
          accessor: function ({ args }) {
            return (
              args[1]?.destination?.statusCode ??
              args[1]?._res?.statusCode ??
              ""
            );
          },
        },
      ],
    },
  ],
};

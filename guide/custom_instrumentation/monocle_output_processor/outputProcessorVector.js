const VECTOR_OUTPUT_PROCESSOR = {
  type: "retrieval",
  attributes: [
    [
      {
        _comment: "vector store name and type",
        attribute: "name",
        accessor: arguments => arguments.instance.constructor.name
      },
      {
        attribute: "type",
        accessor: arguments => "vectorstore." + arguments.instance.constructor.name
      },
      {
        attribute: "deployment",
        accessor: () => ""
      }
    ],
    [
      {
        _comment: "embedding model name and type",
        attribute: "name",
        accessor: arguments => arguments.instance.model
      },
      {
        attribute: "type",
        accessor: arguments => "model.embedding." + arguments.instance.model
      }
    ]
  ],
  events: [
    {
      name: "data.input",
      _comment: "query input to vector store",
      attributes: [
        {
          attribute: "input",
          accessor: arguments => arguments.args[0] || null
        }
      ]
    },
    {
      name: "data.output",
      _comment: "results from vector store search",
      attributes: [
        {
          attribute: "response",
          accessor: arguments => {
            if (!arguments.response) return "";
            return arguments.response
              .map(item => item.metadata.text || "")
              .filter(text => text)
              .join(", ");
          }
        }
      ]
    }
  ]
};

module.exports = { VECTOR_OUTPUT_PROCESSOR };

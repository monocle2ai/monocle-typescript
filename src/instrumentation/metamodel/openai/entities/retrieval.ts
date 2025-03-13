export const config = {
    type: "retrieval",
    attributes: [
        [
            {
                _comment: "LLM Model",
                attribute: "name",
                accessor: function ({ args }) {
                    return args[0].model
                }
            },
            {
                attribute: "type",
                accessor: function ({ args }) {
                    return args[0].model && "model.embedding." + args[0].model;

                }
            }
        ]
    ],
    events: [
        {
            name: "data.input",
            attributes: [
                {
                    _comment: "this is input to LLM",
                    attribute: "input",
                    accessor: function ({
                        args
                    }) {
                        return args[0].input
                    }
                }
            ]
        },
        {
            name: "data.output",
            attributes: [
                {
                    _comment: "this is response from LLM",
                    attribute: "response",
                    accessor: function ({ response }) {
                        if (response && response.data && response.data[0] && response.data[0].embedding) {
                            const embedding: any[] = response.data[0].embedding;
                            return embedding.slice(0, 10).toString() + "..."
                        }
                        return ""
                    }
                }
            ]
        }
    ]
};
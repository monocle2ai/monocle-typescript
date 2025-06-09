import { getExceptionMessage, getStatus, getStatusCode } from "../../utils";

export const config = {
    type: "retrieval",
    attributes: [
        [
            {
                _comment: "LLM Model",
                attribute: "name",
                accessor: function ({ args, instance }) {
                    // pick last part from the url instance._client.baseURL
                    if(instance._client.baseURL && !instance._client.baseURL.includes("openai.com"))
                    {
                        return instance._client.baseURL.split("/").pop()
                    }
                    return args[0].model
                }
            },
            {
                attribute: "type",
                accessor: function ({ args, instance }) {
                    // pick last part from the url instance._client.baseURL
                    if(instance._client.baseURL && !instance._client.baseURL.includes("openai.com"))
                        {
                            return "model.embedding." + instance._client.baseURL.split("/").pop()
                        }
                        return "model.embedding." + args[0].model
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
                    accessor: function ({ response, exception }) {
                        if (exception){
                            return getExceptionMessage({ exception });
                        }
                        if (response && response.data && response.data[0] && response.data[0].embedding) {
                            const embedding: any[] = response.data[0].embedding;
                            return embedding.slice(0, 10).toString() + "..."
                        }
                        return ""
                    }
                },
                {
                    "attribute": "status",
                    "accessor": (args) => {
                        return getStatus(args);
                    }
                },
                {
                    "attribute": "status_code",
                    "accessor": (args) => {
                        return getStatusCode(args);
                    }
                },

            ]
        }
    ]
};
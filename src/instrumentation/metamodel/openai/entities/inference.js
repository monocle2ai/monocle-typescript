exports.config = {
    "type": "inference",
    "events": [
        {
            "name": "data.input",
            "attributes": [

                {
                    "_comment": "this is instruction to LLM",
                    "attribute": "system",
                    "accessor": function ({ args }) {
                        return args[0].messages.filter(item => item.role == 'system')[0]?.content
                    }
                },
                {
                    "_comment": "this is user query to LLM",
                    "attribute": "user",
                    "accessor": function ({ args }) {
                        return args[0].messages.filter(item => item.role == 'user')[0]?.content
                    }
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [

                {
                    "_comment": "this is response from LLM",
                    "attribute": "response",
                    "accessor": function ({ response }) {
                        return response.choices[0].message.content
                    }
                }
            ]
        },
    ]
}
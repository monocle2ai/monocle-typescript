export const config = {
    "type": "agentic.a2a.invocation",
    "attributes": [
        [
            {
                "attribute": "type",
                "accessor": function () {
                    return "agent2agent.server";
                }
            },
            {
                "_comment": "url",
                "attribute": "url",
                "accessor": function ({ instance }) {
                    if (instance?.serviceEndpointUrl) {
                        return instance.serviceEndpointUrl;
                    }
                    return "";
                }
            },
            {
                "_comment": "method",
                "attribute": "method",
                "accessor": function ({ args }) {
                    if (args && args.length >= 2 && args[1] && typeof args[1] === 'object') {
                        const config = args[1];
                        return config.description || "";
                    }
                    return "";
                }
            },
        ]
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "A2A capability request input",
                    "attribute": "input",
                    "accessor": function ({ args }: any): any {
                        try {
                            if (args && args.length > 0 && args[0]?.message?.parts?.length) {
                                const parts = args[0].message.parts;
                                if (parts.length > 0) {
                                    return parts[0].text;
                                }
                            }
                            return JSON.stringify(args[0]) || JSON.stringify(args);
                        } catch {
                            return JSON.stringify(args);
                        }
                    }
                }
            ]
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "A2A capability response output",
                    "attribute": "response",
                    "accessor": function ({ response }) {
                        try {
                            if (response && response?.result) {
                                const result = response.result;
                                if (result.artifacts && result.artifacts.length > 0) {

                                    const parts = result.artifacts[0].parts;
                                    if (parts.length > 0) {
                                        return parts[0].text;
                                    }
                                }
                            }
                            return JSON.stringify(response);
                        } catch {
                            return JSON.stringify(response);
                        }
                    }
                }
            ]
        }
    ],
};
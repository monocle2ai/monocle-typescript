// import { getVectorstoreDeployment } from "../../utils";

export const config = {
    type: "retrieval",
    attributes: [
        [
            {
                _comment: "OpenSearch store name",
                attribute: "name",
                accessor: function ({  }) {
                    return "OpenSearch";
                }
            },
            {
                attribute: "type",
                accessor: function () {
                    return "vectorstore.OpenSearch";
                }
            },
            {
                attribute: "index",
                accessor: function ({ args }) {
                    // Extract index name from the request
                    // instance.connectionPool.connections[0].url.toString()
                    if (args && args[0] && args[0].index) {
                        return args[0].index;
                    }
                }
            },
            {
                attribute: "endpoint",
                accessor: function ({ instance }) {
                    // Extract connection url name from the request
                    if (instance.connectionPool && instance.connectionPool.connections && instance.connectionPool.connections[0]) {
                        return instance.connectionPool.connections.map((connection) => {
                            if (typeof connection.url === "object") {
                                return connection.url.toString();
                            }
                            return ""
                        }).filter((connection) => connection !== "");
                    }
                }
            }
        ]
    ],
    events: [
        {
            name: "data.input",
            attributes: [
                {
                    _comment: "query or input to OpenSearch",
                    attribute: "input",
                    accessor: function ({ args }) {
                        if (!args || !args[0]) return "";

                        if (args[0].body && args[0].body.query) {
                            // For search queries
                            if (args[0].body.query.match_all) {
                                return ["match_all query"];
                            } else if (args[0].body.query.knn) {
                                return ["knn similarity search"];
                            } else if (args[0].body.query.bool) {
                                return ["bool query"];
                            } else if (args[0].body.query.match) {
                                const field = Object.keys(args[0].body.query.match)[0];
                                return [`match query on field: ${field}`];
                            } else {
                                return [JSON.stringify(args[0].body.query)];
                            }
                        } else if (args[0].body && !args[0].body.query) {
                            // For document indexing operations
                            const docId = args[0].id || "unknown_id";
                            return [`indexing document: ${docId}`];
                        }

                        return [JSON.stringify(args[0])];
                    }
                },
                {
                    _comment: "operation metadata",
                    attribute: "request_metadata",
                    accessor: function ({ args }) {
                        if (!args || !args[0]) return {};

                        const metadata: any = {
                            index: args[0].index || null,
                            operation: args[0].body && args[0].body.query ? "search" : "index"
                        };

                        if (args[0].id) metadata.documentId = args[0].id;
                        if (args[0].body && args[0].body.size) metadata.size = args[0].body.size;

                        return metadata;
                    }
                }
            ]
        },
        {
            name: "data.output",
            attributes: [
                {
                    _comment: "response from OpenSearch",
                    attribute: "response",
                    accessor: function ({ response }) {
                        if (!response) return "";

                        try {
                            // For search responses
                            if (response.body && response.body.hits && response.body.hits.hits) {
                                const texts = response.body.hits.hits.map((hit: any) => {
                                    const responseJson = {}
                                    if (hit._source && hit._source.text) {
                                        responseJson["text"] = hit._source.text;
                                    }
                                    if (hit._source && hit._source.id) {
                                        responseJson["id"] = hit._source.id;
                                    }
                                    return JSON.stringify(responseJson);
                                });

                                return texts;
                            }
                            return JSON.stringify(response.body || response);
                        } catch (e) {
                            console.warn(`Warning: Error extracting OpenSearch response: ${e.toString()}`);
                            return "";
                        }
                    }
                },
                {
                    _comment: "performance metrics",
                    attribute: "metrics",
                    accessor: function ({ response }) {
                        const metrics: any = {};

                        try {
                            if (response && response.body) {
                                if (response.body.took) {
                                    metrics.latencyMs = response.body.took;
                                }

                                if (response.body.hits && response.body.hits.total) {
                                    metrics.totalHits = response.body.hits.total.value || response.body.hits.total;
                                }

                                if (response.body._shards) {
                                    metrics.shards = response.body._shards;
                                }
                            }
                        } catch (e) {
                            console.warn(`Warning: Error extracting OpenSearch metrics: ${e.toString()}`);
                        }

                        return metrics;
                    }
                }
            ]
        }
    ]
};

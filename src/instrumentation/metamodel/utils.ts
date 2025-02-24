export function extractMessages(args) {
    /**
     * Extract system and user messages
     */
    try {
        let systemMessage = "";
        let userMessage = "";
        if (args && args.length > 0) {
            if (args[0] && typeof args[0].prompt == "string") {
                userMessage = args[0].prompt
            }
            if (args[0].messages && Array.isArray(args[0].messages)) {
                for (const msg of args[0].messages) {
                    if ('content' in msg && 'role' in msg) {
                        if (msg.role === "system") {
                            systemMessage = msg.content;
                        } else if (["user", "human"].includes(msg.role)) {
                            userMessage = msg.content;
                        }
                    }
                }
            } else if (Array.isArray(args[0])) {
                for (const msg of args[0]) {
                    if ('content' in msg && 'role' in msg) {
                        if (msg.role === "system") {
                            systemMessage = msg.content;
                        } else if (["user", "human"].includes(msg.role)) {
                            userMessage = extractQueryFromContent(msg.content);
                        }
                    }
                }
            }
        }
        return [systemMessage, userMessage];
    } catch (e) {
        console.warn(`Warning: Error occurred in extractMessages: ${e.toString()}`);
        return ["", ""];
    }
}

function extractQueryFromContent(content) {
    try {
        const queryPrefix = "Query:";
        const answerPrefix = "Answer:";

        const queryStart = content.indexOf(queryPrefix);
        if (queryStart === -1) {
            return null;
        }

        const actualQueryStart = queryStart + queryPrefix.length;
        const answerStart = content.indexOf(answerPrefix, actualQueryStart);

        const query = answerStart === -1
            ? content.slice(actualQueryStart).trim()
            : content.slice(actualQueryStart, answerStart).trim();

        return query;
    } catch (e) {
        console.warn(`Warning: Error occurred in extractQueryFromContent: ${e.toString()}`);
        return "";
    }
}

export function extractAssistantMessage(response) {
    try {
        if (response && typeof response.text === "string") {
            return response.text
        }
        if (response[0] && response[0].node && response[0].node.text) {
            return response[0].node.text
        }
        if (typeof response === 'string') {
            return response;
        }
        if (response && response[0] && response[0].pageContent) {
            return response[0].pageContent;
        }

        if ('content' in response) {
            return response.content;
        }

        if (response.message && 'content' in response.message) {
            return response.message.content;
        }

        if ('replies' in response) {
            if ('content' in response.replies[0]) {
                return response.replies[0].content;
            } else {
                return response.replies[0];
            }
        }

        return "";
    } catch (e) {
        console.warn(`Warning: Error occurred in extractAssistantMessage: ${e.toString()}`);
        return "";
    }
}

export function getVectorstoreDeployment(myMap) {
    if (typeof myMap === 'object' && !Array.isArray(myMap)) {
        if ('_client_settings' in myMap) {
            const client = myMap['_client_settings'];
            const { host, port } = client;
            if (host) {
                return port ? `${host}:${port}` : host;
            }
        }
        const keysToCheck = ['client', '_client'];
        const host = getHostFromMap(myMap, keysToCheck);
        if (host) {
            return host;
        }
    } else {
        if (myMap.client && '_endpoint' in myMap.client) {
            return myMap.client['_endpoint'];
        }
        const { host, port } = myMap;
        if (host) {
            return port ? `${host}:${port}` : host;
        }
    }
    return null;
}

function getHostFromMap(map, keys) {
    for (const key of keys) {
        if (key in map) {
            return map[key];
        }
    }
    return null;
}

export function getLlmMetadata({ response, instance }) {
    const metaDict: Record<string, number | null> = {};

    if (response) {
        const tokenUsage = response.raw?.usage || response.response_metadata?.tokenUsage;

        if (tokenUsage) {
            const temperature = (instance as any)?.temperature;
            if (temperature) {
                metaDict['temperature'] = temperature;
            }

            if ('completion_tokens' in tokenUsage || 'completionTokens' in tokenUsage) {
                metaDict['completion_tokens'] = tokenUsage.completion_tokens || tokenUsage.completionTokens;
            }
            if ('prompt_tokens' in tokenUsage || 'promptTokens' in tokenUsage) {
                metaDict['prompt_tokens'] = tokenUsage.prompt_tokens || tokenUsage.promptTokens;
            }
            if ('total_tokens' in tokenUsage || 'totalTokens' in tokenUsage) {
                metaDict['total_tokens'] = tokenUsage.total_tokens || tokenUsage.totalTokens;
            }
        }
    }

    return metaDict;
}


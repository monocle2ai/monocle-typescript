export const config = {
    "type": "inference",
    "events": [
        {
            "name": "data.input",
            "attributes": [

                {
                    "_comment": "this is input to LLM",
                    "attribute": "input",
                    "accessor": function ({ args }) {
                        try {
                            const messages: string[] = [];
                            if (args[0].messages && args[0].messages.length > 0) {
                                for (const msg of args[0].messages) {
                                    if (msg.content && msg.role) {
                                        messages.push(`{ '${[msg.role]}': '${msg.content} }'`);
                                    }
                                }
                            }
                            
                            return messages
                        } catch (e) {
                            console.warn(`Warning: Error occurred in extractMessages: ${e}`);
                            return [];
                        }

                        
                        // const inputUser = args[0].messages.filter(item => item.role == 'user')[0]?.content
                        // const inputSystem =  args[0].messages.filter(item => item.role == 'system')[0]?.content
                        // const retVal : string[] = []
                        // if(inputUser){
                        //     retVal.push(inputUser)
                        // }
                        // if(inputSystem){                        
                        //     retVal.push(inputSystem)
                        // }
                        // return retVal
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
                        return [response.choices[0].message.content]
                    }
                }
            ]
        },
    ]
}
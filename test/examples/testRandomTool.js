const { setupMonocle } = require("../../dist");
setupMonocle("openai.agents");

const { Agent, run, tool } = require('@openai/agents');

// Create a random number generator tool
const randomNumberTool = tool({
    name: 'random_number_generator',
    description: 'Generate a random number between two given numbers (inclusive)',
    parameters: {
        type: 'object',
        properties: {
            min: {
                type: 'number',
                description: 'The minimum number (inclusive)'
            },
            max: {
                type: 'number',
                description: 'The maximum number (inclusive)'
            }
        },
        required: ['min', 'max'],
        additionalProperties: false
    },
    func: ({ min, max }) => {
        console.log(`Tool called with min: ${min}, max: ${max}`);
        if (min > max) {
            throw new Error('Minimum value cannot be greater than maximum value');
        }

        // Generate random number between min and max (inclusive)
        const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
        const result = `Generated random number: ${randomNumber} (between ${min} and ${max})`;
        console.log(`Tool returning: ${result}`);
        return result;
    }
});

async function main() {
    try {
        console.log('🎲 Testing random number tool...');

        // Create agent with just the random number tool
        const agent = new Agent({
            name: 'Random Number Assistant',
            instructions: `You are a helpful assistant with a random number generator tool. 
                          Use the random_number_generator tool to generate random numbers when requested.`,
            tools: [randomNumberTool]
        });

        console.log('🔄 Running random number request...');
        const result = await run(
            agent,
            'Generate a random number between 1 and 100.'
        );

        console.log('✅ Result:', result.finalOutput);

    } catch (error) {
        console.error('❌ Error during execution:', error);
    }
}

main().catch(console.error);

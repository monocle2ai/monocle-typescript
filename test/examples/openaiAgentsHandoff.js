const { setupMonocle } = require("../../dist");
setupMonocle("openai.agents", [], [], 'console');

const { Agent, run, handoff } = require('@openai/agents');

// Create specialized agents
const mathAgent = new Agent({
    name: 'Math Specialist',
    instructions: 'You are a math specialist. You can solve mathematical problems and calculations.',
});

const weatherAgent = new Agent({
    name: 'Weather Specialist',
    instructions: 'You are a weather specialist. You provide weather information for different locations.',
});

// Create handoffs for delegation
// const mathHandoff = handoff(mathAgent, {
//     toolNameOverride: 'transfer_to_math',
//     toolDescriptionOverride: 'Transfer the conversation to the math specialist for mathematical problems',
// });

// const weatherHandoff = handoff(weatherAgent, {
//     toolNameOverride: 'transfer_to_weather', 
//     toolDescriptionOverride: 'Transfer the conversation to the weather specialist for weather-related questions',
// });

// Create supervisor agent that can delegate to specialists
const supervisorAgent = Agent.create({
    name: 'Supervisor Agent',
    instructions: `You are a supervisor agent that MUST delegate tasks to specialist agents. 
    For mathematical problems, you MUST use the transfer_to_math tool.
    For weather questions, you MUST use the transfer_to_weather tool.
    Never answer questions directly - always delegate to the appropriate specialist.`,
    handoffs: [mathAgent, weatherAgent]
});

async function main() {
    try {
        console.log('Testing agent delegation with handoffs...');

        const result = await run(
            supervisorAgent,
            'I need help with two things: 1) Calculate 15 + 27 multiplied by 3 (please transfer to math specialist), 2) Get weather for New York (please transfer to weather specialist)'
        );

        console.log('Result:', result);

    } catch (error) {
        console.error('Error during execution:', error);
    }
}

main().catch(console.error);

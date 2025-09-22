const { setupMonocle } = require("../../dist");
setupMonocle("openai.agents", [], [], 'console');

const { Agent, run, handoff } = require('@openai/agents');
const { z } = require('zod');

// Create specialized agents
const additionAgent = new Agent({
    name: 'Addition Specialist',
    instructions: 'You are an addition specialist. You can ONLY perform addition operations (adding numbers together). You are excellent at adding any numbers, whether integers, decimals, or fractions.',
});

const subtractionAgent = new Agent({
    name: 'Subtraction Specialist', 
    instructions: 'You are a subtraction specialist. You can ONLY perform subtraction operations (subtracting numbers). You are excellent at subtracting any numbers, whether integers, decimals, or fractions.',
});

// Create handoffs for delegation
const additionHandoff = handoff(additionAgent, {
    toolNameOverride: 'do_addition',
    toolDescriptionOverride: 'Perform addition operations - adding numbers together',
    inputType: z.object({ 
        numbers: z.string().describe('The numbers to add together (e.g., "15 + 27 + 10")')
    }),
    onHandoff: async (context, input) => {
        console.log('Addition handoff triggered with input:', input);
        console.log(`Performing addition: ${input.numbers}`);
    }
});

const subtractionHandoff = handoff(subtractionAgent, {
    toolNameOverride: 'do_subtraction', 
    toolDescriptionOverride: 'Perform subtraction operations - subtracting numbers',
    inputType: z.object({ 
        numbers: z.string().describe('The numbers for subtraction (e.g., "100 - 25 - 10")')
    }),
    onHandoff: async (context, input) => {
        console.log('Subtraction handoff triggered with input:', input);
        console.log(`Performing subtraction: ${input.numbers}`);
    }
});

// Create supervisor agent that can delegate to specialists
const supervisorAgent = Agent.create({
    name: 'Math Supervisor Agent',
    instructions: `You are a math supervisor agent that delegates arithmetic operations to specialist agents. 

    DELEGATION RULES:
    - For ANY addition operations (adding numbers): use do_addition tool
    - For ANY subtraction operations (subtracting numbers): use do_subtraction tool
    
    IMPORTANT: You must delegate each operation separately. If multiple operations are requested, use multiple tool calls.
    
    Always delegate - never attempt to perform math calculations yourself.`,
    handoffs: [additionHandoff, subtractionHandoff]
});

async function main() {
    try {
        console.log('Testing agent delegation with addition and subtraction specialists...');

        // First request - Addition only
        console.log('Making addition request...');
        const result = await run(
            supervisorAgent,
            'Please add these numbers: 15 + 27 + 8'
        );
        console.log('Addition Result:', result);

        // Second request - Subtraction only  
        console.log('Making subtraction request...');
        const subtractionResult = await run(
            supervisorAgent,
            'Please subtract these numbers: 100 - 25 - 15'
        );
        console.log('Subtraction Result:', subtractionResult);

    } catch (error) {
        console.error('Error during execution:', error);
    }
}

main().catch(console.error);

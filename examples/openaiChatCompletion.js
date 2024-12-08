const { setupMonocle } = require("../src")
const { BatchSpanProcessor, ConsoleSpanExporter } = require("@opentelemetry/sdk-trace-node")

setupMonocle(
    "openai.app",
    [
        new BatchSpanProcessor(
            new ConsoleSpanExporter(),
            {
                scheduledDelayMillis: 1
            })
    ]
)

const { OpenAI } = require('openai')


const client = new OpenAI({
    apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
});

async function main() {
    const chatCompletion = await client.chat.completions.create({
        messages: [{ role: 'user', content: 'Say this is a test' }],
        model: 'gpt-4o',
    });
    console.log(chatCompletion.choices[0].message.content);
}

main()
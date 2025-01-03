const { setupMonocle } = require("../src")
const { BatchSpanProcessor, ConsoleSpanExporter } = require("@opentelemetry/sdk-trace-node")
const { MonocleConsoleSpanExporter } = require("../src/exporters/monocle/MonocleConsoleSpanExporter")

setupMonocle(
    "openai.app",
    [
        new BatchSpanProcessor(
            new MonocleConsoleSpanExporter(),
            {
                scheduledDelayMillis: 0
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

    setTimeout(() => {
        console.log("shutting exporter")
    }, 1000);
}

main()
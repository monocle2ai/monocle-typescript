const { setupMonocle } = require("../src")

setupMonocle(
    "openai.app"
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
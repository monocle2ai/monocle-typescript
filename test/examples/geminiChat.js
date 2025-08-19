const { setupMonocle } = require("../../dist");
setupMonocle("gemini.app");

const { GoogleGenAI } = require("@google/genai");


async function geminiChat(ai) {
  try {
    const response =
      await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Explain how AI works in a few words",
      });
    console.log(response.text);
  } catch (e) {
    console.error("Error during generateContent:", e);
    return;
  }
}

async function geminiDirectGeneration(ai) {
  try {
    console.log("Direct content generation...");

    // First message
    const response1 = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "I have 2 dogs in my house."
    });

    console.log("Response 1:");
    console.log(response1.text);

    // Second message (context-free)
    const response2 = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "How many paws are in my house?"
    });

    console.log("\nResponse 2:");
    console.log(response2.text);

    // A more contextual conversation would require maintaining history manually
    const conversationResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: "I have 2 dogs in my house." }]
        },
        {
          role: "model",
          parts: [{ text: response1.text }]
        },
        {
          role: "user",
          parts: [{ text: "How many paws are in my house?" }]
        }
      ]
    });

    console.log("\nContextual Response:");
    console.log(conversationResponse.text);

  } catch (error) {
    console.error("Error during Gemini generation:", error);
  }
}


async function geminiChatEmbedding(ai) {
  try {

    const response = await ai.models.embedContent({
      model: 'gemini-embedding-exp-03-07',
      contents: 'What is the meaning of life?',
    });

    console.log(response.embeddings);
  } catch (e) {
    console.error("Error during generateContent:", e);
    return;
  }
}

async function main() {
  try {
    await geminiChat(new GoogleGenAI({}));
    await geminiDirectGeneration(new GoogleGenAI({}));
    await geminiChatEmbedding(new GoogleGenAI({}));
    // await geminiChat(new GoogleGenAI({ apiKey: "INVALID_KEY" }));
    // await geminiChatEmbedding(new GoogleGenAI({ apiKey: "INVALID_KEY" }));

    // // for vertex AI
    // await geminiChat(new GoogleGenAI({vertexai:true,project:"fluent-radar-408119", location:"us-east5"}));
    // await geminiDirectGeneration(new GoogleGenAI({vertexai:true,project:"fluent-radar-408119", location:"us-east5"}));
    // await geminiChatEmbedding(new GoogleGenAI({vertexai:true,project:"fluent-radar-408119", location:"us-east5"}));

  } catch (e) {
    console.error("Error during gemini chat:", e);
  }
}

if (require.main === module) {
  (async () => {
    await main();
    // Wait 5 seconds then exit
    setTimeout(() => {
      console.log("Exiting after 5 seconds...");
      process.exit(0);
    }, 5_000);
  })();
}

module.exports = { main };
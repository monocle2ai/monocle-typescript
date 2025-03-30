const { setupMonocle } = require("../../dist");

setupMonocle("bedrock.app");
const {
  BedrockRuntimeClient,
  InvokeModelCommand
} = require("@aws-sdk/client-bedrock-runtime");

async function invokeBedrockModel() {
  // Initialize the Bedrock client
  const client = new BedrockRuntimeClient({ region: "us-east-1" });

  // Request payload for Claude model
  const requestPayload = {
    prompt: "\n\nHuman: What is coffee?\n\nAssistant: ",
    max_tokens_to_sample: 500,
    temperature: 0.7,
    top_p: 1
  };
  const requestData = JSON.stringify(requestPayload);

  const command = new InvokeModelCommand({
    modelId: "anthropic.claude-v2",
    body: requestData,
    contentType: "application/json"
  });

  try {
    console.log("Invoking Bedrock model...");
    const response = await client.send(command);

    let decodedResponse;
    try {
      if (response.body) {
        const buffer = Buffer.from(response.body);
        decodedResponse = buffer.toString();
        decodedResponse = JSON.parse(decodedResponse);
      }
    } catch (e) {
      decodedResponse = "Error decoding response";
    }

    console.log("Bedrock Response:", {
      statusCode: response.$metadata.httpStatusCode,
      payload: decodedResponse ? decodedResponse.completion : "No payload"
    });

    return {
      command: {
        input: {
          modelId: "anthropic.claude-v2",
          body: requestData,
          contentType: "application/json"
        }
      },
      response: response
    };
  } catch (error) {
    console.error("Error invoking Bedrock model:", error);
    throw error;
  }
}

if (require.main === module){  // Check if the script is run directly
  // If this file is run directly, invoke the function
  invokeBedrockModel().catch(console.error);
}

module.exports = {
  main: invokeBedrockModel
};


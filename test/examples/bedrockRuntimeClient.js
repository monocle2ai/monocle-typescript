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
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: "What is coffee?"
      }
    ],
    temperature: 0.7,
    top_p: 1
  };
  const requestData = JSON.stringify(requestPayload);

  const command = new InvokeModelCommand({
    modelId: "anthropic.claude-3-sonnet-20240229-v1:0",  // Using the latest Claude 3 model
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
      payload: decodedResponse?.content || "No payload"
    });

    return {
      command: {
        input: {
          modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
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

if (require.main === module) {  // Check if the script is run directly
  // If this file is run directly, invoke the function
  invokeBedrockModel().catch(console.error);
}

module.exports = {
  main: invokeBedrockModel,
};

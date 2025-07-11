const { setupMonocle } = require('../../dist');
setupMonocle("openai.app");

const {
  SageMakerRuntimeClient,
  InvokeEndpointCommand
} = require("@aws-sdk/client-sagemaker-runtime");

async function invokeSageMakerEndpoint(
  client,
  question = "What is coffee?",
  context = "Coffee is a beverage brewed from roasted, ground coffee beans."
) {
  // Request payload in required format
  const requestPayload = {
    question,
    context,
  };
  const requestData = JSON.stringify(requestPayload);

  const command = new InvokeEndpointCommand({
    EndpointName: "okahu-sagemaker-rag-qa-ep",
    Body: requestData,
    ContentType: "application/json"
  });

  try {
    console.log("Invoking SageMaker endpoint...");
    const response = await client.send(command);

    let decodedResponse;
    try {
      if (response.Body) {
        const buffer = Buffer.from(response.Body);
        decodedResponse = buffer.toString();
        decodedResponse = JSON.parse(decodedResponse);
      }
    } catch (e) {
      decodedResponse = "Error decoding response";
    }

    console.log("SageMaker Response:", {
      statusCode: response.$metadata.httpStatusCode,
      requestId: response.$metadata.requestId,
      payload: decodedResponse || "No payload"
    });

    return {
      command: {
        input: {
          EndpointName: "okahu-sagemaker-rag-qa-ep",
          Body: requestData,
          ContentType: "application/json"
        }
      },
      response: response
    };
  } catch (error) {
    console.error("Error invoking SageMaker endpoint:", error);
    throw error;
  }
}


async function main() {
  try {
    const validClient = new SageMakerRuntimeClient({ region: "us-east-1" });
    const invalidClient = new SageMakerRuntimeClient({
      region: "us-east-1",
      credentials: {
        accessKeyId: "INVALID_KEY",
        secretAccessKey: "INVALID_SECRET",
      },
    });

    await invokeSageMakerEndpoint(validClient);
    await invokeSageMakerEndpoint(invalidClient);
  } catch (e) {
    console.error("Error during langchainInvoke:", e);
  }
}

if (require.main === module) {
  (async () => {
    try {
      await main();
    } catch (e) {
      console.error("Error during processing:", e);
    }
    // Wait 5 seconds then exit
    setTimeout(() => {
      console.log("Exiting after 5 seconds...");
      process.exit(0); // force clean exit
    }, 5_000);
  })();
}


module.exports = { main: main };

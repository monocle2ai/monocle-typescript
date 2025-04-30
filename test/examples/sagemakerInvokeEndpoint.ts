
import { 
  SageMakerRuntimeClient, 
  InvokeEndpointCommand 
} from "@aws-sdk/client-sagemaker-runtime";


async function invokeSageMakerEndpoint() {
  // Initialize the SageMaker client
  const client = new SageMakerRuntimeClient({ region: "us-east-1" });

  // Request payload in required format
  const requestPayload = {
    question: "What is coffee?",
    context: "Coffee is a beverage brewed from roasted, ground coffee beans."
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

if (require.main === module) {
  // If this file is run directly, invoke the function
  invokeSageMakerEndpoint().catch(console.error);
}

export {
  invokeSageMakerEndpoint as main
};

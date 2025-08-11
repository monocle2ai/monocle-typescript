const { setupMonocle } = require("../../dist");
setupMonocle("a2a.server");

const { v4: uuidv4 } = require("uuid");
const express = require("express");
const cors = require("cors");
const {
  InMemoryTaskStore,
  DefaultRequestHandler,
} = require("@a2a-js/sdk/server");
const { A2AExpressApp } = require("@a2a-js/sdk/server/express");
const OpenAI = require("openai");
const { A2AClient } = require("@a2a-js/sdk/client");


// Define the agent card for the Math Solver Agent
// This card describes the agent's capabilities, skills, and metadata
// It will be served at the /agent.json endpoint
// and can be used by clients to discover and interact with the agent.
const mathAgentCard = {
  name: "Math Solver Agent",
  description:
    "An agent that can solve math problems and explain the steps using OpenAI.",
  url: "http://localhost:41242/",
  provider: {
    organization: "A2A Agents",
    url: "https://example.com/a2a-agents",
  },
  protocolVersion: "0.3.0",
  version: "1.0.0",
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  securitySchemes: undefined,
  security: undefined,
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "basic_math_solver",
      name: "Basic Math Solver",
      description:
        "Solve basic math problems such as addition, subtraction, multiplication, division, and percentages.",
      tags: ["math", "calculations", "arithmetic"],
      examples: [
        "What is 23 × 7?",
        "Add 15.4 and 27.8",
        "What's 20% of 450?",
        "If a car travels 60 km/h for 3 hours, how far does it go?",
        "Solve 15² + 8²",
      ],
      inputModes: ["text/plain"],
      outputModes: ["text/plain"],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};


// Handle missing OpenAI API key gracefully
let openai;
try {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
} catch (error) {
  console.warn("[MathAgent] OpenAI client initialization failed:", error.message);
  process.exit(1);
}


// MathAgentExecutor handles the execution of tasks for the Math Solver Agent
// It implements the A2AExecutor interface and provides methods to cancel tasks,
// execute tasks, and publish results to the event bus.
// This executor will be used by the DefaultRequestHandler to process incoming requests.
// It listens for user messages, processes math problems using OpenAI,
// and publishes the results back to the event bus as artifacts and status updates.
class MathAgentExecutor {
  constructor() {
    this.cancelledTasks = new Set();
  }

  cancelTask = async (taskId, _eventBus) => {
    this.cancelledTasks.add(taskId);
  };

  async execute(requestContext, eventBus) {
    const userMessage = requestContext.userMessage;
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(`[MathAgentExecutor] Solving math for task ${taskId}`);

    // Publish initial "submitted" task
    if (!requestContext.task) {
      const initialTask = {
        kind: "task",
        id: taskId,
        contextId,
        status: {
          state: "submitted",
          timestamp: new Date().toISOString(),
        },
        history: [userMessage],
        metadata: userMessage.metadata,
        artifacts: [],
      };
      eventBus.publish(initialTask);
    }

    // Publish "working" status
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "working",
        message: {
          kind: "message",
          role: "agent",
          messageId: uuidv4(),
          parts: [{ kind: "text", text: "Calculating answer..." }],
          taskId,
          contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    });

    // Call OpenAI to solve the math problem
    let resultText;
    try {
      // Extract text from the first part (assuming it's a text part)
      console.log("User message parts:", userMessage.parts);
      const firstPart = userMessage.parts[0];
      let userText = "No text provided";
      
      if (firstPart && firstPart.kind === "text") {
        userText = firstPart.text;
      }
      
      if (!openai || !process.env.OPENAI_API_KEY) {
        resultText = `Demo mode: Would solve math problem "${userText}". Please set OPENAI_API_KEY environment variable to use actual OpenAI integration.`;
      } else {
        const completion = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content: "You are a helpful math tutor. Solve math problems step-by-step and explain your reasoning clearly."
            },
            {
              role: "user",
              content: `Solve this math problem and explain step-by-step: ${userText}`
            }
          ],
          max_tokens: 500,
          temperature: 0.1
        });
        resultText = completion.choices[0]?.message?.content || "Could not compute the answer.";
      }
    } catch (error) {
      console.error("OpenAI API Error:", error);
      resultText = `Error calling OpenAI: ${error.message || error}`;
    }

    if (this.cancelledTasks.has(taskId)) {
      console.log(`[MathAgentExecutor] Task ${taskId} cancelled`);
      eventBus.publish({
        kind: "status-update",
        taskId,
        contextId,
        status: { state: "canceled", timestamp: new Date().toISOString() },
        final: true,
      });
      eventBus.finished();
      return;
    }

    // Publish result as artifact
    eventBus.publish({
      kind: "artifact-update",
      taskId,
      contextId,
      artifact: {
        artifactId: "math-result-1",
        name: "Math Solution",
        parts: [{ kind: "text", text: resultText }],
      },
      append: false,
      lastChunk: true,
    });

    // Publish final status
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "completed",
        message: {
          kind: "message",
          role: "agent",
          messageId: uuidv4(),
          parts: [{ kind: "text", text: "Calculation complete." }],
          taskId,
          contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: true,
    });

    eventBus.finished();
  }
}

const taskStore = new InMemoryTaskStore();
const agentExecutor = new MathAgentExecutor();

// Create the request handler using the MathAgentExecutor
// This handler will process incoming requests, execute tasks, and manage the task lifecycle
// It will use the MathAgentExecutor to handle the actual math problem solving.
// The request handler will be used by the A2AExpressApp to route requests to the executor.
console.log("[MathAgent] Creating request handler...");
const requestHandler = new DefaultRequestHandler(
  mathAgentCard,
  taskStore,
  agentExecutor
);

// Create Express app and add CORS middleware first
// This allows the app to handle cross-origin requests
// and enables it to be accessed from different origins, which is useful for testing.
// The app will serve the agent card at the /.well-known/agent.json endpoint
// and handle incoming A2A requests at the /a2a endpoint.
console.log("[MathAgent] Setting up Express app...");
const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

console.log("[MathAgent] Setting up A2A routes...");
const appBuilder = new A2AExpressApp(requestHandler);
const expressApp = appBuilder.setupRoutes(app, "");

console.log("[MathAgent] Starting server...");
const PORT = process.env.MATH_AGENT_PORT || 41242;

try {
  const server = expressApp.listen(PORT, () => {
    console.log(
      `[MathAgent] Server using new framework started on http://localhost:${PORT}`
    );
    console.log(
      `[MathAgent] Agent Card: http://localhost:${PORT}/.well-known/agent.json`
    );
    console.log("[MathAgent] Press Ctrl+C to stop the server");
  });

  server.on('error', (error) => {
    console.error('[MathAgent] Server error:', error);
  });

  // Keep the process alive
  process.stdin.resume();
} catch (error) {
  console.error('[MathAgent] Failed to start server:', error);
}

// Create an A2AClient instance to interact with the agent
// This client will be used in the test script to send messages and receive responses
// It connects to the agent running on the specified URL and provides methods
// to send messages, get task status, and stream responses.
// The client will be used to test the agent's functionality by sending math problems
const client = new A2AClient("http://localhost:41242");


// Test: Basic message sending (blocking)
async function testMessage() {
  console.log("\n=== Test 1: Basic Message Sending ===");
  const messageId = uuidv4();
  let taskId;

  try {
    const sendParams = {
      message: {
        messageId: messageId,
        role: "user",
        parts: [{ kind: "text", text: "What is the square root of 144 plus 12?" }],
        kind: "message",
      },
      configuration: {
        blocking: true,
        acceptedOutputModes: ["text/plain"],
      },
    };

    const textPart = sendParams.message.parts[0];
    console.log(`Sending message: ${textPart.text}`);
    const sendResponse = await client.sendMessage(sendParams);

    if (sendResponse.error) {
      console.error("Error sending message:", sendResponse.error);
      return;
    }

    const result = sendResponse.result;

    if (result.kind === "task") {
      const taskResult = result;
      console.log("Task created:", {
        id: taskResult.id,
        status: taskResult.status.state,
        contextId: taskResult.contextId
      });
      taskId = taskResult.id;
      
      // Wait a bit and check task status
      console.log("Waiting for task completion...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (taskId) {
        const getParams = { id: taskId };
        const getResponse = await client.getTask(getParams);

        if (getResponse.error) {
          console.error(`Error getting task ${taskId}:`, getResponse.error);
          return;
        }

        const getTaskResult = getResponse.result;
        console.log("Final task status:", {
          id: getTaskResult.id,
          status: getTaskResult.status.state,
          artifacts: getTaskResult.artifacts?.length || 0
        });
      }
    } else if (result.kind === "message") {
      const messageResult = result;
      const firstPart = messageResult.parts[0];
      console.log("Direct message response:", firstPart.text);
    }
  } catch (error) {
    console.error("Error in basic message test:", error);
  }
}

// Main test runner
async function runTests() {
  console.log("🎬 Starting A2A Maths Agent Tests...");
  console.log("Agent URL: http://localhost:41242");
  
  try {
    // First verify the agent is running
    console.log("\n=== Verifying Agent Card ===");
    const response = await fetch("http://localhost:41242/.well-known/agent.json");
    if (response.ok) {
      const agentCard = await response.json();
      console.log("✅ Agent card retrieved successfully:");
      console.log(`  Name: ${agentCard.name}`);
      console.log(`  Version: ${agentCard.version}`);
      console.log(`  Skills: ${agentCard.skills?.length || 0}`);
    } else {
      console.error("❌ Failed to retrieve agent card");
      return;
    }

    // Run all tests
    await testMessage();

    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log("\n🎉 All tests completed!");

    process.exit(0); // Exit after tests complete

    
  } catch (error) {
    console.error("❌ Error running tests:", error);
  }
}

// Run tests
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests };
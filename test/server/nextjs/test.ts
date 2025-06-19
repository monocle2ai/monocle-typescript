import { NextServer } from './helper'

async function testForTraces() {
  const server = new NextServer()
  try {
    await server.start()
    console.log('Server is running at:', server.getUrl())
    
    // Test the GET endpoint
    const getResponse = await fetch(`${server.getUrl()}/api/azure-openai-chat`)
    const getData = await getResponse.json()
    console.log('GET Response:', getData)
    
    // Test the POST endpoint
    const postResponse = await fetch(`${server.getUrl()}/api/azure-openai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage: "How do you make a cappuccino?" })
    });
    const postData = await postResponse.json();
    console.log('POST Response:', postData);

    await server.stop()
    await setTimeout(() => {
      console.log("Exiting after 5 seconds...");
      process.exit(0);
    }, 10_000);
  } catch (error) {
    await setTimeout(() => {
      console.log("Exiting after 5 seconds...");
    }, 10_000);
    console.error('Test failed:', error)
    process.exit(1)
  }
}

testForTraces()
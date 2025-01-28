# LangChain Demo with Monocle Instrumentation

This example demonstrates how to integrate Monocle instrumentation into a LangChain application.

## Setup

Install the necessary dependencies:
```
npm install monocle2ai-ts
```
Here is an example of how to add Monocle instrumentation:

```javascript
const { setupMonocle } = require("monocle2ai-ts")

setupMonocle("langchain.app")

// ...existing code...
```

## Running the Example

To run the example with Monocle instrumentation, execute the following command:

```sh
./run-app-with-monocle.sh
```

To run the example without Monocle instrumentation, execute the following command:

```sh
./run-app-without-monocle.sh
```

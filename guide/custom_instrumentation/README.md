# Monocle Custom Instrumentation Guide

Monocle allows you to easily instrument your GenAI applications to capture telemetry for both custom code and third-party libraries. This guide explains how to instrument your code, create output processors, and analyze the resulting telemetry.

## Instrumenting Custom Code

Monocle allows you to instrument your own custom wrappers around GenAI services. The `setupMonocle` function is used to configure instrumentation for your application.

### Basic Setup

```javascript
const { setupMonocle } = require('monocle2ai');

setupMonocle(
  "myapp.name",  // Service name
  [],            // Custom hooks array (empty here)
  [              // Instrumentation configurations array
    {
      "package": require.resolve('./path/to/your/module'),
      "object": "YourClass",
      "method": "yourMethod",
      "spanName": "customSpanName",
      "output_processor": [
        YOUR_OUTPUT_PROCESSOR
      ]
    }
  ]
);
```

### Configuration Parameters

- **package**: Path to the module containing the class to instrument
- **object**: Name of the class or object to instrument
- **method**: Method name to instrument
- **spanName**: Name of the span created when this method is called
- **output_processor**: Array of processors that extract and format telemetry data

## Output Processors

Output processors define how to extract and format telemetry data from method calls. They have access to:

- **arguments**: All arguments passed to the method
- **instance**: The object instance (this)
- **response**: The return value from the method

### Output Processor Structure

```javascript
const EXAMPLE_OUTPUT_PROCESSOR = {
  type: "inference",             // Type of span (inference, retrieval, etc.)
  attributes: [                  // Arrays of attribute definitions
    [
      {
        attribute: "name",
        accessor: arguments => arguments.instance.someProperty
      },
      // More attributes...
    ]
  ],
  events: [                      // Events to capture
    {
      name: "data.input",
      attributes: [
        {
          attribute: "input",
          accessor: arguments => arguments.args[0] || null
        }
      ]
    },
    // More events...
  ]
};
```

## Example: Instrumenting Custom OpenAI Client

Here's how we instrument a custom OpenAI client:

```javascript
setupMonocle(
  "openai.app",
  [],
  [
    {
      "package": require.resolve('./custom_ai_code/openaiClient'),
      "object": "OpenAIClient",
      "method": "chat",
      "spanName": "openaiClient.chat",
      "output_processor": [
        INFERENCE_OUTPUT_PROCESSOR
      ]
    }
  ]
);
```

The `INFERENCE_OUTPUT_PROCESSOR` extracts information like:
- Model name and type from function arguments
- Input prompts from method arguments
- Response text from the method's return value
- Usage metadata from the response object

## Example: Instrumenting Vector Database

```javascript
{
  "package": require.resolve('./custom_ai_code/vectorDb'),
  "object": "InMemoryVectorDB",
  "method": "searchByText",
  "spanName": "vectorDb.searchByText",
  "output_processor": [
    VECTOR_OUTPUT_PROCESSOR
  ]
}
```

The `VECTOR_OUTPUT_PROCESSOR` captures:
- Vector store name and type from the instance
- Embedding model information
- Query inputs and search results

## Instrumenting NPM Modules

You can also instrument third-party NPM modules like Google's Generative AI SDK:

```javascript
{
  "package": "@google/generative-ai",
  "object": "GenerativeModel",
  "method": "generateContent",
  "spanName": "gemini.generateContent",
  "output_processor": [
    GEMINI_OUTPUT_PROCESSOR
  ]
}
```

For NPM modules, specify the package name directly instead of using `require.resolve()`.

## Output Processor to Trace Correlation

Let's see how output processors translate to actual traces:

### Vector DB Processor & Trace

The Vector DB processor extracts:
- Vector store name: `accessor: arguments => arguments.instance.constructor.name`
- Query text: `accessor: arguments => arguments.args[0] || null`
- Results: `accessor: arguments => arguments.response.map(...).join(", ")`

This produces the following trace data:
```json
{
  "name": "vectorDb.searchByText",
  "attributes": {
    "span.type": "retrieval",
    "entity.2.name": "InMemoryVectorDB",
    "entity.2.type": "vectorstore.InMemoryVectorDB",
    "entity.3.name": "text-embedding-ada-002",
    "entity.3.type": "model.embedding.text-embedding-ada-002"
  },
  "events": [
    {
      "name": "data.input",
      "attributes": { "input": "programming languages" }
    },
    {
      "name": "data.output",
      "attributes": { 
        "response": "JavaScript is a high-level programming language, Machine learning is a subset of artificial intelligence"
      }
    }
  ]
}
```

### Gemini Output Processor & Trace

The Gemini output processor extracts:
- Model name: `accessor: arguments => arguments.instance.model`
- Input: `accessor: arguments => ...input text extraction logic...`
- Response: `accessor: arguments => arguments.response.response.text()`
- Usage metrics: Extracting token counts from response metadata

This produces the following trace data:
```json
{
  "name": "gemini.generateContent",
  "attributes": {
    "span.type": "inference",
    "entity.2.type": "gemini",
    "entity.2.provider_name": "Google",
    "entity.2.deployment": "models/gemini-1.5-flash",
    "entity.3.name": "models/gemini-1.5-flash",
    "entity.3.type": "model.llm.models/gemini-1.5-flash"
  },
  "events": [
    {
      "name": "data.input",
      "attributes": { "input": ["Tell me a short joke about programming."] }
    },
    {
      "name": "data.output",
      "attributes": { "response": "Why do programmers prefer dark mode?  Because light attracts bugs!\n" }
    },
    {
      "name": "metadata",
      "attributes": {
        "prompt_tokens": 8,
        "completion_tokens": 14,
        "total_tokens": 22
      }
    }
  ]
}
```

## Best Practices

1. **Accessor Functions**: Write robust accessor functions that handle missing or malformed data
2. **Attribute Organization**: Group related attributes within the same array in the `attributes` section
3. **Events**: Use standard event names like `data.input`, `data.output`, and `metadata`
4. **Error Handling**: Add proper error handling in accessors to avoid instrumentation failures

## Conclusion

Monocle's custom instrumentation provides a flexible way to track your GenAI application's behavior. By defining output processors, you can extract meaningful telemetry data from any GenAI component, whether it's your custom code or a third-party library.

# Running the Examples

This directory contains examples of how to use Monocle for custom instrumentation with different AI providers and vector databases.

## OpenAI Example
To run the OpenAI custom instrumentation example:

```bash
# Make the script executable
chmod +x run_custom_code_example.sh

# Run the script
./run_custom_code_example.sh
```

This script will:
1. Set up the MONOCLE_EXPORTER environment variable
2. Prompt for your OpenAI API key if not already set
3. Install necessary dependencies
4. Run the OpenAI example code

## Gemini Example
To run the Gemini API instrumentation example:

```bash
# Make the script executable
chmod +x run_gemini_sdk_code_example.sh

# Run the script
./run_gemini_sdk_code_example.sh
```

This script will:
1. Set up the MONOCLE_EXPORTER environment variable
2. Prompt for your OpenAI and Gemini API keys if not already set
3. Install necessary dependencies
4. Run the Gemini example code

## What These Examples Demonstrate

1. **Custom Instrumentation Setup**: How to set up Monocle's instrumentation for different AI libraries
2. **Output Processors**: How to define custom output processors for various AI services
3. **Vector Database Integration**: How to instrument vector database operations
4. **Multiple Service Tracing**: How to trace operations across multiple AI services in a single application

## Requirements

- Node.js and npm
- OpenAI API key (for OpenAI example)
- Google Gemini API key (for Gemini example)

## File Structure

### Output Processors
Output processors define how Monocle should process and format data from different AI services:

- [`outputProcessorInference.js`](./monocle_output_processor/outputProcessorInference.js) - Processor for OpenAI API calls
- [`outputProcessorGemini.js`](./monocle_output_processor/outputProcessorGemini.js) - Processor for Google's Gemini API calls
- [`outputProcessorVector.js`](./monocle_output_processor/outputProcessorVector.js) - Processor for vector database operations

### Example Implementations
- [`exampleCustom.js`](./exampleCustom.js) - Example of custom instrumentation with OpenAI and a vector database
- [`exampleGemini.js`](./exampleGemini.js) - Example of custom instrumentation with Google's Gemini API and a vector database
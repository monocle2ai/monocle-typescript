# Changelog

All notable changes to Monocle TypeScript will be documented in this file.
## 0.4.0 (2026-07-28)

### Features

- **Google ADK Support**

- **Gemini Enhancements**
  - Added extraction for declared tool names and types in inference requests [#107](https://github.com/monocle2ai/monocle-typescript/pull/107)
  - Added dynamic subtypes to inference spans [#97](https://github.com/monocle2ai/monocle-typescript/pull/97)
  - Enhanced token usage reporting in metadata
  - Capture system input and tool-call output in inference spans [#99](https://github.com/monocle2ai/monocle-typescript/pull/99)
  - Updated instrumented method and integration tests [#106](https://github.com/monocle2ai/monocle-typescript/pull/106)

- **Exporter Improvements**
  - Enhanced FileSpanExporter to flush all spans in single file with updated file naming convention [#98](https://github.com/monocle2ai/monocle-typescript/pull/98)
  - Updated AWS and Azure exporters' file naming convention for exported traces [#112](https://github.com/monocle2ai/monocle-typescript/pull/112)

### Bug Fixes

- **LangChain**
  - Fixed LangChain inference spans across LLM providers (OpenAI, Gemini, Anthropic, Bedrock) [#113](https://github.com/monocle2ai/monocle-typescript/pull/113)
  - Updated LangChain and OpenAI inference spans structure [#111](https://github.com/monocle2ai/monocle-typescript/pull/111)

- **OpenAI**
  - Fixed OpenAI embeddings span to be retrieval instead of modelapi [#115](https://github.com/monocle2ai/monocle-typescript/pull/115)

- **Span Handling**
  - Removed auto generation of session IDs when not provided by external app [#101](https://github.com/monocle2ai/monocle-typescript/pull/101)
  - Removed `to_agent` property from agentic span [#100](https://github.com/monocle2ai/monocle-typescript/pull/100)
  - Removed unused agent tool names extraction and updated tool subtype to content generation [#105](https://github.com/monocle2ai/monocle-typescript/pull/105)
  - Improved comments and streamlined `skipProcessor` logic in OpenAISpanHandler

- **Configuration**
  - Disabled Monocle's global tracer provider registration [#108](https://github.com/monocle2ai/monocle-typescript/pull/108)
  - Hidden Langgraph and OpenAI SDK instrumentation [#103](https://github.com/monocle2ai/monocle-typescript/pull/103)

### Testing

- Added unit tests for ADK and Gemini schemas, including delegation and finish_reason accessors [#102](https://github.com/monocle2ai/monocle-typescript/pull/102)

## 0.3.1 (2026-03-25)
- Okahu eval exporter support

## 0.3.0 (2025-09-09)

### Features

- **Agent Support**
  - Added instrumentation for LlamaIndex agents [#78](https://github.com/monocle2ai/monocle-typescript/pull/78)
  - Added instrumentation for LangGraph agents

### Bug Fixes

- Fixed default .monocle path configuration [#83](https://github.com/monocle2ai/monocle-typescript/pull/83)
- Set ./.monocle as default trace export path for file exporter [#82](https://github.com/monocle2ai/monocle-typescript/pull/82)

## 0.1.2 (2025-04-02)

### Features

- **AWS Services**
  - Added instrumentation for AWS Bedrock [#40](https://github.com/monocle2ai/monocle-typescript/pull/40)
  - Added instrumentation for AWS SageMaker [#40](https://github.com/monocle2ai/monocle-typescript/pull/40)
  - Added instrumentation for AWS OpenSearch [#40](https://github.com/monocle2ai/monocle-typescript/pull/40)

### Bug Fixes

- Fixed Azure Blob file naming issues [#44](https://github.com/monocle2ai/monocle-typescript/pull/44)
- Fixed Windows-Linux compatibility issues [#44](https://github.com/monocle2ai/monocle-typescript/pull/44)

### Maintenance

- Removed unused files [#43](https://github.com/monocle2ai/monocle-typescript/pull/43)

## 0.1.0 (2025-03-25)

### Features

- **Core Instrumentation**
  - Added OpenTelemetry-based instrumentation for AI/ML frameworks
  - Implemented support for LangChain, LlamaIndex, and OpenAI
  - Created flexible metamodel for capturing AI operations and attributes
  - Added span handlers for workflow and operation tracking
  - Implemented context propagation for distributed tracing

- **AI Framework Support**
  - **LangChain**
    - Implemented instrumentation for BaseChatModel, RunnableParallel, RunnableSequence
    - Added support for VectorStoreRetriever and PromptTemplate operations
    - Created inference and retrieval output processors
  
  - **LlamaIndex**
    - Implemented instrumentation for VectorIndexRetriever, RetrieverQueryEngine
    - Added support for OpenAI and BaseLLM methods
    - Created dedicated extraction methods for LlamaIndex specific objects

  - **OpenAI**
    - Added direct instrumentation for OpenAI client operations
    - Implemented input message extraction and response processing

- **Exporters**
  - Added multiple exporter options for telemetry data:
    - Console exporter for development and debugging
    - File exporter for local analysis
    - AWS S3 exporter for cloud storage
    - Azure Blob Storage exporter for Microsoft environments
    - Okahu exporter for centralized analysis

- **Utilities**
  - Implemented metadata extraction for token usage tracking
  - Added utilities for vector store deployment identification
  - Created helper methods for message extraction from various AI frameworks
  - Added support for identifying infrastructure environment (AWS Lambda, Azure, etc.)

- **Lambda Support**
  - Implemented special handling for AWS Lambda environments
  - Added Lambda extension for asynchronous processing
  - Created specialized task processor for efficient telemetry export

- **Developer Experience**
  - Added comprehensive documentation with examples
  - Created sample implementations and output processors
  - Added debug logging with MONOCLE_DEBUG environment variable control
  - Implemented custom instrumentation examples for Gemini and OpenAI

### Documentation
- Added custom instrumentation guide with examples
- Created examples for vector database integration
- Added sample output processors for different AI frameworks
- Provided sample traces showing the correlation between processors and telemetry

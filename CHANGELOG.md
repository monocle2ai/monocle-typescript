# Changelog

All notable changes to Monocle TypeScript will be documented in this file.

## 0.1.2-beta.2 (2025-04-21)

### Features

- **Vercel**
  - Added handling for Vercel environments [#58](https://github.com/monocle2ai/monocle-typescript/pull/58)
  - Added instrumentation for Vercel AI SDK [#48](https://github.com/monocle2ai/monocle-typescript/pull/48)

- **Anthropic**
  - Added instrumentation for Anthropic SDK [#47](https://github.com/monocle2ai/monocle-typescript/pull/47)

- **OpenAI**
  - Added responses and sync responses methods for OpenAI
  - Upgraded OpenAI SDK [#51](https://github.com/monocle2ai/monocle-typescript/pull/51)

- **Workflow**
  - Added workflow span changes [#56](https://github.com/monocle2ai/monocle-typescript/pull/56)

- **SDK**
  - Generic SDK changes [#57](https://github.com/monocle2ai/monocle-typescript/pull/57)

- **Exporter**
  - Support passing exporter list as parameter to `setup_monocle_telemetry()` [#54](https://github.com/monocle2ai/monocle-typescript/pull/54)

### Maintenance

- Updated tests [#55](https://github.com/monocle2ai/monocle-typescript/pull/55)
- Added new TypeScript compile process [#50](https://github.com/monocle2ai/monocle-typescript/pull/50)
- Fix CommonJS issues [#52](https://github.com/monocle2ai/monocle-typescript/pull/52)

## 0.1.2-beta.1 (2025-04-02)

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

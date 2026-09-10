# Changelog

All notable changes to Monocle TypeScript will be documented in this file.
## 0.4.2 (2026-09-09)

### Features

- **`monocle2ai run` CLI** [#117](https://github.com/monocle2ai/monocle-typescript/pull/117)
  - Added `npx monocle2ai run <file> [args...]`, which traces a script without editing it — `monocle2ai/register` is preloaded before the target file loads, so the file needs no `setupMonocle()` call
  - The target runs under `tsx`, covering TypeScript and both module systems; when tsx is not installed it is fetched with `npx` for that run only, leaving `package.json`, the lockfile and `node_modules` untouched
  - tsx and npx are resolved through the running `node` binary rather than `node_modules/.bin`, so no shell shim is spawned (Windows `.cmd` shims made Node return `EINVAL`)
  - stdio is inherited and arguments after the file are passed through untouched, so interactive scripts and scripts with their own flags still work
  - Added `--help` and `--version`, and a failed spawn now prints tsx install guidance instead of a raw Node stack

- **`.env.monocle` settings file** [#117](https://github.com/monocle2ai/monocle-typescript/pull/117)
  - Monocle now reads its own settings from `.env.monocle` beside `package.json`, so the same settings apply however the app is started — including Next.js and `mastra dev`, which never see a `--env-file` flag
  - Parsed with Node's own `util.parseEnv`, so the file and `--env-file` cannot disagree; the file is authoritative and its values replace what is already in the environment
  - A missing, unreadable, or unsupported file is reported and ignored rather than thrown (reading it needs Node 20.12 / 21.7+)
  - `NODE_OPTIONS` remains in `.env`, since Node applies it before startup; everything else belongs in `.env.monocle`

- **Default exporter** [#117](https://github.com/monocle2ai/monocle-typescript/pull/117)
  - With no `MONOCLE_EXPORTER` set, traces are now written as JSON under `.monocle/` by the file exporter instead of printed by the console exporter

- **Documentation**
  - README now covers `monocle2ai run`, `.env.monocle`, and running either from the [Okahu AI Debugging Agent](https://marketplace.visualstudio.com/items?itemName=OkahuAI.okahu-ai-observability) VS Code extension [#117](https://github.com/monocle2ai/monocle-typescript/pull/117)

### Bug Fixes

- **ESM Instrumentation**
  - Excluded TypeScript sources and `openai/_shims` from import-in-the-middle: IITM claimed `.ts` files before native type stripping, so TS syntax reached V8 and threw, and wrapping openai's module-level shim registry left `core.mjs` reading an uninitialised copy [#117](https://github.com/monocle2ai/monocle-typescript/pull/117)

- **Setup**
  - Made `setupMonocle` idempotent per process — a second call now returns the existing instrumentor instead of building a second tracer provider and exporting every span twice, which the CLI's preload plus an app's own `setupMonocle()` call would otherwise do [#117](https://github.com/monocle2ai/monocle-typescript/pull/117)
  - Reached `util.parseEnv` through the namespace rather than as a named import, so older Node runtimes without it fail gracefully instead of taking the ESM preload down with a load-time `SyntaxError` [#117](https://github.com/monocle2ai/monocle-typescript/pull/117)

### Testing

- Added unit tests for CLI argument parsing, run-plan and runner resolution, single-run spawn behavior, CLI messages, `.env.monocle` loading, ESM hook exclusions, and setup idempotency [#117](https://github.com/monocle2ai/monocle-typescript/pull/117)

## 0.4.1 (2026-08-25)

### Features

- **Mastra AI Support** [#114](https://github.com/monocle2ai/monocle-typescript/pull/114)
  - Added instrumentation for Mastra agents with `agentic.request` turn spans
  - Added `agentic.invocation` spans per agent activation, nested inside the turn span, with `from_agent` / `from_agent_span_id` delegation tracking
  - Added inference spans for `agent.generate` and `agent.stream`, including input/output capture for streaming
  - Added tool schema and wrapper for tool execution instrumentation; internal Mastra tool invocation spans between agent invocations are hidden

- **ESM and Next.js Compatibility** [#114](https://github.com/monocle2ai/monocle-typescript/pull/114)
  - Added `monocle2ai/register` preload entry for `--import` / `NODE_OPTIONS`, so instrumentation is set up before the app's import graph loads
  - Added `withMonocle` helper (`monocle2ai/next`) that keeps the Monocle chain and instrumented SDKs external from the Next.js bundle
  - Unified CommonJS and ESM instrumentation onto a single template
  - Updated README with ESM, CommonJS, and Next.js setup instructions, and added `.env.example`

### Bug Fixes

- **File Exporter**
  - Append late-arriving spans and keep the flush window open for the idle duration, while retaining close-on-root behavior [#114](https://github.com/monocle2ai/monocle-typescript/pull/114)

### Testing

- Added unit and integration tests for Mastra instrumentation, stream completion, the file span exporter, global instrumentor setup, and Next.js externals [#114](https://github.com/monocle2ai/monocle-typescript/pull/114)

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

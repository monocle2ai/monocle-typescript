# Google ADK Instrumentation

Monocle auto-instruments [`@google/adk`](https://www.npmjs.com/package/@google/adk) (v1.1.0+) so agentic apps emit OpenTelemetry spans with no code changes beyond `setupMonocle()`.

## How it works

1. `setupMonocle()` registers `import-in-the-middle` / `require-in-the-middle` loader hooks against the top-level `@google/adk` package.
2. When user code first imports `@google/adk`, Monocle uses Shimmer to wrap five method prototypes on the publicly re-exported classes (`Runner`, `BaseAgent`, `FunctionTool`, `AgentTool`).
3. Each wrapped call enters `wrapper.ts` → opens an OTel span → invokes the original method → on completion, an `output_processor` schema reads `{instance, args, response}` to populate `entity.N.*` attributes and `data.input` / `data.output` events.
4. Methods that return `AsyncGenerator` (`Runner.run*`, `BaseAgent.runAsync`) are wrapped in a passthrough generator: yielded events are collected, and the span ends when iteration completes — not when the generator object is returned. Each `iterator.next()` runs inside `context.with(spanContext, …)` so that nested wrapped calls (e.g. `Runner.runEphemeral` → `Runner.runAsync` → `BaseAgent.runAsync`) inherit the correct active span and produce a single trace with proper `parent_id` chain.
5. ADK installs **no-op spans** on the standard OTel active-span slot at every layer (`tracer.startSpan('invocation' / 'invoke_agent X' / 'call_llm')`) and binds them via `context.bind` for the inner generator. To prevent these from polluting the parent chain, Monocle stamps its active span on a private context key (`MONOCLE_ACTIVE_SPAN_KEY`). When a wrapped method starts, it consults this key first; if set, it uses that span as parent. Frameworks that don't go through the AsyncGenerator binding (langchain, openai, anthropic, …) never set the key and fall through to the standard OTel active span — zero behavior change.

Wrapping at the *base class* propagates through the prototype chain, so `LlmAgent` / `LoopAgent` / `SequentialAgent` / `InMemoryRunner` etc. are all covered by one hook each.

## Methods instrumented

| Class.method | Span name | Span type | Schema |
|---|---|---|---|
| `Runner.runAsync` | `adk.runner.run_async` | `agentic.request` | `AGENT_REQUEST` |
| `Runner.runEphemeral` | `adk.runner.run_ephemeral` | `agentic.request` | `AGENT_REQUEST` |
| `BaseAgent.runAsync` | `adk.agent.run` | `agentic.invocation` | `AGENT` |
| `FunctionTool.runAsync` | `adk.tool` | `agentic.tool.invocation` | `TOOL` |
| `AgentTool.runAsync` | `adk.agent_as_tool` | `agentic.delegation` | `AGENT_DELEGATION` |

The Gemini model call is instrumented separately via the pre-existing `@google/genai` hook — no extra config needed.

## Trace tree (typical travel-agent run)

```
workflow                                 (workflow.adk)
└─ adk.runner.run_ephemeral              (agentic.request)
   └─ adk.agent.run                      (agentic.invocation, agent.adk)
      ├─ gemini.generate_content         (inference)              ← @google/genai hook
      └─ adk.tool                        (agentic.tool.invocation, tool.adk)
```

## Span attribute reference

**`adk.tool` span** (representative):

```jsonc
{
  "name": "adk.tool",
  "attributes": {
    "span.type": "agentic.tool.invocation",
    "span.subtype": "routing",
    "entity.1.type": "tool.adk",
    "entity.1.name": "adk_book_flight",
    "entity.1.description": "Books a flight between two airports.",
    "entity.2.type": "agent.adk",
    "entity.2.name": "adk_flight_booking_agent",
    "entity.count": 2
  },
  "events": [
    { "name": "data.input",  "attributes": { "Inputs":   ["{\"from_airport\":\"SFO\",\"to_airport\":\"BOM\"}"] } },
    { "name": "data.output", "attributes": { "response": "{\"status\":\"success\",\"message\":\"...\"}" } }
  ]
}
```

`AGENT` and `AGENT_REQUEST` spans additionally emit a `metadata` event with aggregated token usage (`prompt_tokens`, `completion_tokens`, `total_tokens`) when the model returns `usageMetadata`.

## Source layout

```
src/instrumentation/metamodel/adk/
├── methods.ts                # 5 hook entries on @google/adk
├── adkProcessor.ts           # ADKAgentSpanHandler / ADKRunnerSpanHandler / ADKToolSpanHandler
└── entities/
    ├── inference.ts          # AGENT, AGENT_REQUEST, AGENT_DELEGATION schemas
    └── tools.ts              # TOOL schema
```

Touchpoints in shared code:
- `src/instrumentation/common/wrapper.ts` — added `AsyncGenerator` branch (collects yielded events, ends span on iteration completion).
- `src/instrumentation/common/spanHandler.ts` — `WORKFLOW_TYPE_MAP` includes `"@google/adk": "workflow.adk"`.
- `src/instrumentation/common/constants.ts` — `ADK_AGENT_NAME_KEY` symbol for context propagation.
- `src/instrumentation/common/packages.ts` — registers `adkPackages`.

## Running the tests

`@google/adk` is a `devDependency`; ensure it's installed:

```bash
npm install
```

Run only the ADK tests (~15 s; the wait is two `BatchSpanProcessor` flushes):

```bash
npx vitest run test/integration/adk.test.ts
```

Other useful targets:

```bash
npm run test:unit          # unit tests (covers the wrapper change)
npm test                   # full suite
```

The test fixtures live at:

- `test/examples/adkToolSample.js` — exercises `FunctionTool.runAsync` (no API key needed).
- `test/examples/adkAgentSample.js` — exercises `BaseAgent.runAsync` with a stubbed `runAsyncImpl` (no model call).

Both samples `require('../../dist')`, so build first if `src/` has changed:

```bash
npm run build
```

## Seeing spans without the test harness

```bash
npm run build

# Tool path
node -e "require('./test/examples/adkToolSample.js').main().then(() => new Promise(r => setTimeout(r, 6000)))" | jq

# Agent path (stubbed model)
node -e "require('./test/examples/adkAgentSample.js').main().then(() => new Promise(r => setTimeout(r, 6000)))" | jq
```

## Wiring it into your own ADK app

```ts
// At the very top of your entrypoint, before any @google/adk import:
import { setupMonocle } from 'monocle2ai';
setupMonocle('travel.agent');

// ...rest of your app unchanged
```

Configure the exporter via `MONOCLE_EXPORTER` (`console` | `file` | `okahu` | `s3` | `blob`, comma-separated). Default is `console`.

```bash
export MONOCLE_EXPORTER=console
node dist/index.js "Book a flight from SFO to BOM"
```

## Limitations / future work

- `BaseLlm.generateContentAsync` is not separately wrapped; the `@google/genai` hook covers the model call. Add a wrap with `SPAN_TYPES.INFERENCE_FRAMEWORK` if you want a framework-layer view of the resolved request (system instructions, tool declarations).
- Live / audio path (`runLive`, `BaseLlm.connect`) is not instrumented.
- ADK callbacks (`beforeAgentCallback` / `beforeToolCallback`) are not surfaced as spans — they're user-supplied hooks, not SDK surface.

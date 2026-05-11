# Google ADK Instrumentation

Monocle auto-instruments [`@google/adk`](https://www.npmjs.com/package/@google/adk) (v1.1.0+) so agentic apps emit OpenTelemetry spans with no code changes beyond `setupMonocle()`.

## How it works

1. `setupMonocle()` registers `import-in-the-middle` / `require-in-the-middle` loader hooks against the top-level `@google/adk` package.
2. When user code first imports `@google/adk`, Monocle uses Shimmer to wrap four method prototypes on the publicly re-exported classes (`Runner`, `BaseAgent`, `FunctionTool`). Delegation is captured as attributes on the child agent's invocation span (`from_agent`, `from_agent_span_id`) — matching Python monocle's behavior — rather than as a separate `agentic.delegation` span.
3. Each wrapped call enters `wrapper.ts` → opens an OTel span → invokes the original method → on completion, an `output_processor` schema reads `{instance, args, response}` to populate `entity.N.*` attributes and `data.input` / `data.output` events.
4. Methods that return `AsyncGenerator` (`Runner.run*`, `BaseAgent.runAsync`) are wrapped in a passthrough generator: yielded events are collected, and the span ends when iteration completes — not when the generator object is returned. Each `iterator.next()` runs inside `context.with(spanContext, …)` so that nested wrapped calls (e.g. `Runner.runEphemeral` → `Runner.runAsync` → `BaseAgent.runAsync`) inherit the correct active span and produce a single trace with proper `parent_id` chain.
5. ADK installs its own spans on the standard OTel active-span slot at every layer (`tracer.startSpan('invocation' / 'invoke_agent X' / 'call_llm')`) and binds them via `context.bind` for the inner generator. To prevent these from polluting Monocle's parent chain, Monocle stamps its active span on a private context key (`MONOCLE_ACTIVE_SPAN_KEY`). When a wrapped method starts, it consults this key first; if set, it uses that span as parent. Frameworks that don't go through the AsyncGenerator binding (langchain, openai, anthropic, …) never set the key and fall through to the standard OTel active span — zero behavior change.
6. `setupMonocle()` also calls `trace.setGlobalTracerProvider(...)` so ADK's `trace.getTracer('gcp.vertex.agent')` resolves to Monocle's real tracer (instead of OTel's no-op fallback). The call is defensive — if another OTel consumer has already registered a global provider, Monocle leaves it alone. With the global wired, ADK's internal spans are real and would otherwise flow into your trace output; the `PatchedBatchSpanProcessor` drops anything missing the `monocle_apptrace.version` attribute before export so you only see Monocle-fingerprinted spans by default. Both behaviors are env-var-toggleable — see "Operating modes" below.

Wrapping at the *base class* propagates through the prototype chain, so `LlmAgent` / `LoopAgent` / `SequentialAgent` / `InMemoryRunner` etc. are all covered by one hook each.

## Methods instrumented

| Class.method | Span name | Span type | Schema |
|---|---|---|---|
| `Runner.runAsync` | `adk.runner.run_async` | `agentic.request` | `AGENT_REQUEST` |
| `Runner.runEphemeral` | `adk.runner.run_ephemeral` | `agentic.request` | `AGENT_REQUEST` |
| `BaseAgent.runAsync` | `adk.agent.run` | `agentic.invocation` | `AGENT` |
| `FunctionTool.runAsync` | `adk.tool` | `agentic.tool.invocation` | `TOOL` |

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
    ├── inference.ts          # AGENT, AGENT_REQUEST schemas
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

## Operating modes & env vars

Two env vars control how Monocle handles ADK's internal spans and parent-chain construction. Both can live in your `.env` file (read lazily at span-creation / span-end time, so dotenv loading order doesn't matter for these).

| Env var | Default | Effect |
|---|---|---|
| `MONOCLE_ISOLATE_SPANS` | `true` | When `true`, Monocle wrappers pick parents from a private context key, keeping the parent chain pointing exclusively at Monocle spans regardless of what ADK installs on the OTel active-span slot. Set to `false` to use OTel's natural active-span chain (Monocle spans will then parent under whatever ADK most recently set as active). |
| `MONOCLE_INCLUDE_ALL_SPANS` | `false` | When `false`, the span processor drops spans missing the `monocle_apptrace.version` attribute — i.e. anything that wasn't created by Monocle's wrappers (ADK's `invocation` / `invoke_agent X` / `call_llm` spans, or any other framework's internal OTel spans). Set to `true` to let everything through to your exporters. |

### Three useful preset combos

**Default — clean Monocle-only traces** (what you want 95% of the time):
```env
MONOCLE_ISOLATE_SPANS=true
MONOCLE_INCLUDE_ALL_SPANS=false
```

**Debug ADK — see Monocle traces *plus* ADK's internal spans alongside:**
```env
MONOCLE_ISOLATE_SPANS=true
MONOCLE_INCLUDE_ALL_SPANS=true
```
Monocle's parent chain stays tight (one tree of Monocle spans). ADK's spans appear as a parallel sub-tree under the same `trace_id`.

**Deep debug — fully interleaved Monocle ↔ ADK chain:**
```env
MONOCLE_ISOLATE_SPANS=false
MONOCLE_INCLUDE_ALL_SPANS=true
```
Monocle spans parent under whatever's currently on the OTel active-span slot — meaning Monocle spans interleave with ADK spans as one combined tree. Useful for "why is ADK calling X" investigations.

**Avoid this combo** — `MONOCLE_ISOLATE_SPANS=false` + `MONOCLE_INCLUDE_ALL_SPANS=false`. Monocle spans would parent under ADK spans that the filter then drops, leaving dangling `parent_id` references in your output.

## Limitations / future work

- `BaseLlm.generateContentAsync` is not separately wrapped; the `@google/genai` hook covers the model call. Add a wrap with `SPAN_TYPES.INFERENCE_FRAMEWORK` if you want a framework-layer view of the resolved request (system instructions, tool declarations).
- Live / audio path (`runLive`, `BaseLlm.connect`) is not instrumented.
- ADK callbacks (`beforeAgentCallback` / `beforeToolCallback`) are not surfaced as spans — they're user-supplied hooks, not SDK surface.

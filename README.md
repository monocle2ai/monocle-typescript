# Monocle for tracing GenAI app code

**Monocle** helps developers and platform engineers building or managing GenAI apps monitor these in prod by making it easy to instrument their code to capture traces that are compliant with open-source cloud-native observability ecosystem. 

**Monocle** is a community-driven OSS framework for tracing GenAI app code governed as a [Linux Foundation AI & Data project](https://lfaidata.foundation/projects/monocle/). 

## Why Monocle

Monocle is built for: 
- **app developers** to trace their app code in any environment without lots of custom code decoration 
- **platform engineers** to instrument apps in prod through wrapping instead of asking app devs to recode
- **GenAI component providers** to add observability features to their products 
- **enterprises** to consume traces from GenAI apps in their existing open-source observability stack

Benefits:
- Monocle provides an implementation + package, not just a spec 
   - No expertise in OpenTelemetry spec required
   - No bespoke implementation of that spec required
   - No last-mile GenAI domain specific code required to instrument your app
- Monocle provides consistency  
   - Connect traces across app code executions, model inference or data retrievals
   - No cleansing of telemetry data across GenAI component providers required
   - Works the same in personal lab dev or org cloud prod environments
   - Send traces to location that fits your scale, budget and observability stack
- Monocle is fully open source and community driven
   - No vendor lock-in
   - Implementation is transparent
   - You can freely use or customize it to fit your needs 

## What Monocle provides

- Easy to [use](#use-monocle) code instrumentation
- OpenTelemetry compatible format for spans. 
- Community-curated and extensible metamodel for consistent tracing of GenAI components. 
- Export to local and cloud storage 

## Use Monocle

Install:

```
npm install --save monocle2ai
```

Monocle instruments GenAI libraries (OpenAI, LangChain, LlamaIndex, Mastra, …) by
hooking them **at module load**, so Monocle must be set up **before your app imports
those libraries**. One preload does this for both ESM and CommonJS; Next.js and
`mastra dev` supply it their own way.

### Run one file, without changing anything

To trace a single script — an agent, a prototype, a reproduction — there is nothing to
set up:

```
npx monocle2ai run src/agent.ts
```

Tracing is preloaded before your file loads, so the file needs no `setupMonocle()` call
and your project keeps its `package.json`, lockfile and `node_modules` as they are. The
file runs exactly as it would otherwise: arguments after the path are passed through,
and stdin stays connected, so an agent that prompts for input still works.

```
npx monocle2ai run src/agent.ts --city Berlin
```

The target runs under [tsx](https://tsx.is), which handles TypeScript and both module
systems. If tsx is not installed, Monocle fetches it with `npx` for the run only and
tells you it did — nothing is added to your project.

Name the workflow and choose where traces go with a `.env.monocle` file beside your
`package.json`:

```
# .env.monocle
MONOCLE_WORKFLOW_NAME=my-agent
MONOCLE_EXPORTER=file
```

Monocle reads this file itself, so it applies however the app is started — including
Next.js and `mastra dev`, which never see a `--env-file` flag. With no exporter set,
traces are written as JSON under `.monocle/`. **Reading `.env.monocle` needs Node 20.12
or 21.7+**; on older releases, set the variables in the environment instead.

Use this to trace a run. To trace an application you start yourself — `npm start`, a
dev server, anything with its own entry point — use the preload below instead.

#### From VS Code

The [Okahu AI Debugging Agent](https://marketplace.visualstudio.com/items?itemName=OkahuAI.okahu-ai-observability)
extension for VS Code runs the same command for you, from either of two places:

- **The sidebar.** Open the Okahu AI Observability view in the activity bar and pick
  **Run Agent with Monocle2AI** under **TOOLS**.
- **The editor.** Right-click the file and choose **Monocle → Run Agent with
  Monocle2AI**.

Both act on the file open in the editor and route on its language, so a TypeScript file
runs through `monocle2ai run` — a terminal opens in the project and the file runs
traced.

**Instrument using Monocle2AI**, in the same two places, does the other half: it adds
the preload to your `.env`, writes `.env.monocle`, and offers to add `--env-file` to
whichever npm scripts you pick — for an app you start yourself rather than a file you
run once.

### Node / tsx scripts (ESM and CommonJS)

The same setup works for both module systems. Put the preload in `.env` — only the
preload, since Node has to read it before startup and everything else belongs in
`.env.monocle`:

```
# .env
NODE_OPTIONS=--import monocle2ai/register
```

```
# .env.monocle — read by Monocle itself
MONOCLE_WORKFLOW_NAME=my-app
MONOCLE_EXPORTER=file
```

and pass `--env-file` when you launch, so Node reads the preload **at startup**:

```jsonc
// package.json
"scripts": {
  "start": "node --env-file=.env index.js",                 // CommonJS
  "agent": "npx tsx --env-file=.env src/scripts/agent.ts"   // ESM / TypeScript
}
```

Nothing goes in your application code — no `setupMonocle()` call, no instrumentation
file. The preload registers hooks for **both** `import` (via import-in-the-middle) and
`require` (via require-in-the-middle) before your app loads, so it covers ESM and CJS
alike.

Equivalent, if you would rather not use a `.env` file:

```
node --import monocle2ai/register index.js
npx tsx --import monocle2ai/register src/scripts/agent.ts
```

**Requires Node 20.6+ (or 18.20+).** `--env-file` and `--import` were added in those
releases; on older Node, export the variables in your shell instead.

#### Things that look equivalent but are not

- **`import "dotenv/config"` cannot replace `--env-file`.** dotenv runs inside your
  program, long after Node has decided whether to preload anything, so `NODE_OPTIONS`
  set that way is ignored — silently. Node must see the variable before it starts.
  (dotenv is fine for variables read later, such as API keys.)
- **`--require monocle2ai/register` is not a substitute for `--import`.** The CommonJS
  build cannot register the ESM loader hook, so `--require` traces CJS only. `--import`
  covers both.
- **A top-of-file `import` of your own setup module is not enough in ESM.** The whole
  import graph is resolved before any of your code runs, so the instrumented libraries
  are already loaded by the time `setupMonocle()` executes.

#### TypeScript files that use `import`, in a package without `"type": "module"`

If `package.json` has no `"type"` field, Node decides CommonJS vs ESM **per file, from
its syntax**. A `.ts` file containing any `import`/`export` is therefore treated as an
ES module, goes through the ESM loader, and can fail to load with:

```
Error: 'import-in-the-middle' failed to wrap 'file:///.../your-file.ts'
TypeError [ERR_INVALID_RETURN_PROPERTY_VALUE]: Expected string, array buffer, or typed
array to be returned for the "source" from the "load" hook but got undefined
```

Nothing in that message points at Monocle, but it only appears once the preload is
active. Either fix works:

- add `"type": "module"` to `package.json` (preferred for a TypeScript project), or
- keep the file pure CommonJS — `require()` only, no `import`/`export`. Note a lone
  `export {};` is enough to flip the file to ESM.

A `.ts` file that uses only `require()` loads as CommonJS and is instrumented normally.

#### CommonJS without any flags

CommonJS has one extra option, because `require` is lazy rather than hoisted: call
`setupMonocle` yourself before requiring the instrumented libraries.

```js
require("dotenv/config");                 // load .env first, so MONOCLE_* are set
const { setupMonocle } = require("monocle2ai");
setupMonocle("your-app-name");

const OpenAI = require("openai");         // required AFTER setupMonocle → hooked
```

Order matters twice: `dotenv` before `setupMonocle` (otherwise `MONOCLE_EXPORTER` is
not set yet and traces fall back to the console), and `setupMonocle` before any
instrumented `require`. Anything loaded earlier cannot be patched.

This is not needed if you use the `--env-file` setup above, and the two are safe to
combine — the preload will not double-instrument.

### Next.js

Two small, standard touches — no `--import`/`NODE_OPTIONS` needed (Next's
instrumentation hook is the preload):

1. `next.config.ts` — wrap your config with `withMonocle`. A bundler would otherwise
   inline Monocle and the instrumented packages, leaving nothing to hook.
   `withMonocle` keeps them external (it externalizes a curated set of safe backend
   SDKs by default; pass app-specific ones via `externalPackages`):

   ```ts
   import type { NextConfig } from "next";
   import { withMonocle } from "monocle2ai/next";

   const nextConfig: NextConfig = {
     /* your Next.js config options here (optional) */
   };

   export default withMonocle(nextConfig, {
     // instrumented packages your app uses that aren't in the safe defaults
     externalPackages: ["@mastra/core", "@mastra/ai-sdk", "@mastra/loggers"],
   });
   ```

   Your `nextConfig` is merged in, so any options you add there are preserved
   (including your own `serverExternalPackages` / `webpack`, which `withMonocle`
   unions with its additions).

2. `src/instrumentation.ts` — Next runs `register()` before your app; set up Monocle there:

   ```ts
   import { setupMonocle } from "monocle2ai";
   export function register() {
     setupMonocle("my-app");
   }
   ```

### mastra dev

`mastra dev` bundles your app and spawns a server process, reading `.env` itself and
forwarding it. Set the preload in `.env` and it reaches the spawned process at
startup — no `--env-file` flag needed here, unlike a script you launch with
`node`/`tsx` directly:

```
# .env
NODE_OPTIONS=--import monocle2ai/register
```

### Hook audit

Under a bundler (Next.js), if an instrumented dependency is installed but never gets
hooked — usually because it was bundled/inlined and can't be traced — Monocle logs a
one-time warning telling you to externalize it. Silence or tune it with
`MONOCLE_DISABLE_HOOK_AUDIT` / `MONOCLE_HOOK_AUDIT_DELAY_MS` / `MONOCLE_FORCE_HOOK_AUDIT`.

### HTTP spans

Monocle hooks `node:http`, so every request gets a `workflow` + `http.process` span
pair. Nothing to enable, and it covers Express, Fastify, Koa, NestJS and `next start`
alike.

Spans include the **request and response bodies**, truncated at 1000 and 5000
characters. Binary content types are skipped.

**Streamed responses** (the handler called `res.write()`) carry three extra fields in
`data.output`: `time_to_first_byte_ms`, `chunk_count` and `end_reason`. TTFB is the one
worth having — span duration alone can't separate an agent slow to *start* answering
from one slow to finish.

`end_reason` is `complete`, `client_closed` or `error`. A client closing a stream it was
reading is **not** an error: that's how a healthy SSE response ends, so the span stays
OK. A client that disconnects before any byte was written still is. A stream the
**server** tears down reports `error`, distinguished by Node's `res.errored`.

One case is invisible by design: a handler that catches its own failure, reports it
inside the stream and ends normally has completed a successful HTTP exchange. The span
says `complete` — the failure is application-level and lives in the body.

#### What is excluded out of the box

**Always:** `/_next/`, `/__nextjs`, `/assets/`, `/.well-known/`, `/favicon.ico` — build
output, dev tooling and browser incidentals.

**When `@mastra/core` is loaded:** the whole `/api` namespace, then the endpoints that
actually run something are kept — `send-message`, `generate`, `stream`, `resume`,
`network`, tool `execute`, workflow `start` and the rest, 52 routes. Also `/`,
`/mastra-*`, `/__refresh` and `/__restart-active-workflow-runs`.

This is the one place Monocle lists what to *trace* rather than what to drop, and it's
safe because Mastra owns `/api` outright: routes you register with `registerApiRoute()`
mount at the **root**, and adding agents adds `:agentId` values rather than endpoints.
Mastra's surface is 280 management routes against 52 execution ones, and the management
side grows with every playground feature.

On real traces that takes a Mastra playground session from 48 spans to 1, and a Next.js
app from 151 to 39. Outside Mastra, `/` is never excluded — too many apps serve real
traffic there.

#### Configuring it

```
MONOCLE_HTTP_EXCLUDE_PATHS=/auth/login,/internal/   # never trace these
MONOCLE_HTTP_ALLOW_PATHS=/assets/report.json$       # trace despite any exclusion
```

An excluded request is served exactly as if Monocle weren't installed: no span, no body
capture, no response patching. Precedence, first match wins:

| | | |
|---|---|---|
| 1 | `MONOCLE_HTTP_ALLOW_PATHS` | **traced** |
| 2 | `MONOCLE_HTTP_EXCLUDE_PATHS` | excluded |
| 3 | Mastra's execution routes | **traced** |
| 4 | the built-in defaults | excluded |
| 5 | nothing matched | **traced** |

Both of your levers outrank both built-in lists, and within each pair the one that keeps
data wins. Your exclude list is additive to the defaults; the allow list is how you take
an exclusion *back*, whether it came from a default, from Mastra's tier or from your own
list.

#### Pattern grammar

Both variables take a comma-separated list and share one grammar. Entries are
case-insensitive and matched against the original request target — the path as it
arrived on the wire, not the mount-relative path a router sees, so a route mounted at
`app.use("/api", router)` needs `/api/login`, never `/login`.

| pattern | matches |
|---|---|
| `/health` | `/health`, `/health/ready` — and `/healthcheck-api`, since it's a **character** prefix |
| `/health/` | the subtree only, not a bare `/health` |
| `/api/orders$` | `/api/orders` exactly; `/api/orders/42` still reported |
| `/api/users/*/avatar$` | one path segment per `*`, any user id |
| `GET /api/internal/` | reads of that subtree; writes still traced |

Every entry must start with `/`. One written as `health`, or as a full URL, silently
never matches — there is no warning. The path is normalised before comparison (query
stripped, percent-encoding decoded, `//` and `..` resolved), so `/login` also covers
`/LOGIN`, `/log%69n` and `/x/../login?next=/`.

#### Health check sampling

Probes every few seconds would fill your trace with spans carrying no information, so
Monocle exports **one in a hundred** — and **never samples away a failure**.

A span counts as a health check when it's a `GET`/`HEAD` with no query string and no
body, returns success, and either has an empty response or targets a known probe route:
`/health`, `/healthz`, `/healthcheck`, `/health-check`, `/livez`, `/liveness`,
`/readyz`, `/readiness`, `/ping`, `/_health`, plus anything ending in one of those such
as `/actuator/health`. Everything else exports at full rate.

Each probe route counts separately and the first request to one always exports, so a
route never looks dead awaiting its first sample. Contentless responses on unlisted
routes are sampled too, sharing one counter.

```
MONOCLE_SAMPLE_HEALTH_CHECKS=false                      # export every health span
MONOCLE_HEALTH_CHECK_ROUTES=/health,/status-check       # replaces the defaults
MONOCLE_HEALTH_CHECK_SAMPLE_RATE=20                     # one in 20
```

Sampling and exclusion are independent: an excluded path produces no span at all, so a
failure on it is invisible, while a sampled one still reports failures. Use exclusion
for paths you never want traced and leave probes to sampling. `MONOCLE_HTTP_ALLOW_PATHS`
overrides exclusion but **not** sampling, so allowing a contentless `GET` still gives 1
span in 100 unless you also set `MONOCLE_SAMPLE_HEALTH_CHECKS=false`.

#### Worth knowing

- **Bodies are not redacted.** Whatever a client posts to your login route — password
  included — lands in the span and goes wherever your exporter sends it.
  `MONOCLE_HTTP_EXCLUDE_PATHS` is the lever; there's no switch that turns HTTP spans
  off. Conversely, allowing a path back restores its capture, so keep allow entries
  narrow.
- **Static assets are traced.** `express.static` produces a span pair per file served,
  so an app serving its front end from the API server sees trace volume track total HTTP
  traffic rather than AI workload.
- **Span names are duck-typed** from Express's `req.route`/`req.baseUrl`. Frameworks
  that don't set them — Fastify, Koa, `next start` — fall back to the concrete path, so
  `/users/12345` and `/users/12346` become distinct span names. Exclude parameterised
  routes there to bound cardinality.
- **A sampled-away probe that does instrumented work** leaves its child spans parentless,
  since they were exported before the decision. Exclude such a route instead.

### Returning traces on the HTTP response

A test running outside your server can't see the spans a request produced. Turn on trace
return and the server appends them to the response it was already sending — no backend,
shared database or log scraping in the loop.

Set both in `.env.monocle` **before the process starts**; the tracer provider fixes its
span processors at construction, so flipping this later does nothing:

```
MONOCLE_ENABLE_TRACE_RETURN=true
MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY=some-shared-secret
```

Nothing in your app changes. A client asks for traces by sending the key:

```
curl -H "x-monocle-retrieve-traces: some-shared-secret" localhost:3000/chat
```

The response comes back as `<your body><delimiter><base64(gzip(spans))>`, with
`x-monocle-traces: v1; delim=<delimiter>` in the headers; the client cuts the body at
the delimiter to recover the untouched response plus the spans.
[monocle_test_tools](https://docs.okahu.ai/monocle_test_tools/) `HttpRunner` does this
for you and runs assertions against the spans.

It's off by default and gated twice — master switch, then a per-request key check with
`crypto.timingSafeEqual`. Every failure path serves a completely normal response, so a
misconfigured server leaks nothing.

- An authorized request is served uncompressed; Monocle strips `accept-encoding` so a
  compression middleware can't gzip the response out from under the trailer. Other
  clients still get compression.
- `Content-Length` is dropped on a traced response, falling back to chunked encoding,
  which keeps streaming and SSE working without buffering.
- `MONOCLE_TRACE_RETRIEVAL_CALLBACK` (`"module:export"`) replaces the key check with your
  own synchronous `(headers) => boolean`.

### Configuration

See [.env.example](.env.example) for all environment variables — exporters
(console/file/S3/Azure/Okahu), output paths, preload, hook audit, and debug.

Everything except `NODE_OPTIONS` belongs in `.env.monocle`, which Monocle reads for
itself. Its values take precedence over the environment, so the same settings apply
whichever way the app is started. `NODE_OPTIONS` is the exception: Node applies it
before startup, so it has to be somewhere Node reads — your `.env`, or the shell.
## Roadmap 

Goal of Monocle is to support tracing for apps written in *any language* with *any LLM orchestration or agentic framework* and built using models, vectors, agents or other components served up by *any cloud or model inference provider*. 

Current version supports: 
- Language: (🟢) Typescript
- LLM-frameworks: (🟢) Langchain, (🟢) Llamaindex, (🟢) OpenAI, 
- Exporter: (🟢) stdout, (🟢) file, (🟢) Azure Blob Storage, (🟢) AWS S3


## Get involved
### Provide feedback
- Submit issues and enhancements requests via Github issues

### Contribute
- Monocle is community based open source project. We welcome your contributions. Please refer to the CONTRIBUTING and CODE_OF_CONDUCT for guidelines. The contributor's guide provides technical details of the project.


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

### HTTP spans and `MONOCLE_HTTP_EXCLUDE_PATHS`

Monocle hooks `node:http`, so every request your server handles gets a
`workflow` + `http.process` span pair, exported like any other span. Nothing to
enable — this happens as soon as Monocle is set up, and it covers Express,
Fastify, Koa, NestJS and `next start` alike.

Those spans include the **request body and the response body**. The request body
is truncated at 1000 characters and the response body at 5000, so a long stream
simply stops accumulating rather than growing the span.

**Static assets are traced too.** `express.static`, and any middleware like it,
produces its own `workflow` + `http.process` pair for every file served, and the
bodies of textual assets — JavaScript, CSS, HTML — are captured up to that same
5000 characters. Images and other binary content types are skipped. An app that
serves its front end from the same server as its API will therefore see trace
volume track total HTTP traffic rather than AI workload.

**Span names are duck-typed from Express's `req.route` and `req.baseUrl`.** A
framework that does not set them — Fastify, Koa, `next start` — falls back to the
concrete path, so `/users/12345` and `/users/12346` become two distinct span
names. On those frameworks, excluding parameterised routes is how you keep
span-name cardinality bounded.

For both of these, `MONOCLE_HTTP_EXCLUDE_PATHS` is the lever — there is no
switch that turns HTTP spans off.

**Bodies are not redacted.** Whatever a client posts to your login route — the
password included — lands in the span, and goes wherever your exporter sends it.
`MONOCLE_HTTP_EXCLUDE_PATHS` is the mechanism for keeping a sensitive route out
of tracing entirely:

```
MONOCLE_HTTP_EXCLUDE_PATHS=/health,/auth/login,/internal/
```

An excluded request is served exactly as if Monocle were not installed: no spans,
no body capture, no response patching.

A reasonable starting point, to paste and then prune. Monocle applies none of it
on your behalf: nothing is excluded until you say so.

```
MONOCLE_HTTP_EXCLUDE_PATHS=/health,/metrics,/favicon.ico,/static,/_next,/assets
```

`/_next` covers Next.js build assets, and `/static` and `/assets` the usual
Express and bundler conventions; drop whichever your app does not serve, and add
the mount paths it does.

How the list is matched:

- **Comma-separated prefixes, not exact paths.** `/health` excludes `/health`
  and `/health/ready` — and also `/healthcheck-api`, because the match is on the
  string, not on path segments. Check what else in your app starts with the same
  characters before adding a short prefix.
- **Matched against the original request target**, the path as it arrived on the
  wire — not the mount-relative path a router or middleware sees. A login route
  mounted with `app.use("/api", router)` is excluded by `/api/login`, never by
  `/login`.
- **A trailing slash narrows it.** `/health/` excludes `/health/ready` and
  everything else under that subtree, but *not* a bare request to `/health`. Use
  this when a short prefix would otherwise catch neighbouring routes.
- **Every prefix must start with `/`.** A prefix written as `health`, or as a
  full URL like `https://api.example.com/health`, silently never matches an
  ordinary request: what it is compared against is a path such as `/health`,
  which starts with neither. There is no warning — the route just keeps getting
  traced.
- **Case-insensitive**, and matched against the normalised path: the query string
  is stripped, percent-encoding is decoded, `//` and `..` segments are resolved,
  and an absolute-form request target (`GET http://host/health`) is reduced to
  its path first. So `/login` also covers `/LOGIN`, `/log%69n` and
  `/x/../login?next=/`.
- **Unset or empty excludes nothing.** Every request is traced.

### Returning traces on the HTTP response

A test running outside your server can't see the spans a request produced. Turn on
trace return and the server appends them to the response it was already sending:
the spans travel with the answer, so there's no backend, shared database or log
scraping in the loop.

Set both variables in `.env.monocle` **before the process starts** — the tracer
provider fixes its span processors at construction, so flipping this later does
nothing:

MONOCLE_ENABLE_TRACE_RETURN=true
MONOCLE_TRACE_RETRIEVAL_DEFAULT_KEY=some-shared-secret


Nothing in your app changes. Monocle hooks `node:http`, which covers Express,
Fastify, Koa, NestJS and `next start` alike.

A client asks for traces by sending the key:

curl -H "x-monocle-retrieve-traces: some-shared-secret" localhost:3000/chat


The response comes back as `<your body><delimiter><base64(gzip(spans))>`, with
`x-monocle-traces: v1; delim=<delimiter>` in the headers. The client cuts the body
at the delimiter to recover the untouched response plus the spans.
[monocle_test_tools](https://docs.okahu.ai/monocle_test_tools/) `HttpRunner` does
this for you and runs assertions against the spans.

It is off by default and gated twice — master switch, then a per-request key check
with `crypto.timingSafeEqual`. Every failure path serves a completely normal
response, so a misconfigured server leaks nothing. Requests that don't ask for
traces are untouched and pay one env read and one header lookup.

Notes:
- An authorized request is served uncompressed. Monocle strips `accept-encoding`
  so a compression middleware can't gzip the response out from under the trailer.
  Other clients still get compression as usual.
- `Content-Length` is dropped on a traced response, which falls back to chunked
  encoding. That keeps streaming and SSE working without buffering the body.
- `MONOCLE_TRACE_RETRIEVAL_CALLBACK` (`"module:export"`) replaces the key check with
  your own synchronous `(headers) => boolean`. See [.env.example](.env.example).


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


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

### Node / tsx scripts (ESM and CommonJS)

The same setup works for both module systems. Put the preload in `.env`:

```
# .env
NODE_OPTIONS=--import monocle2ai/register
MONOCLE_WORKFLOW_NAME=my-app        # service name used by monocle2ai/register
MONOCLE_EXPORTER=file
```

and pass `--env-file` when you launch, so Node reads it **at startup**:

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

### Configuration

See [.env.example](.env.example) for all environment variables — exporters
(console/file/S3/Azure/Okahu), output paths, preload, hook audit, and debug.
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


// Preload entry: `--import monocle2ai/register` (or via NODE_OPTIONS). Runs
// setupMonocle before the app's import graph loads, so IITM can hook it. Kept
// separate from the exported API so importing the library doesn't start tracing.
// Service name: MONOCLE_WORKFLOW_NAME (default "monocle-app").
import { setupMonocle } from "./instrumentation/common/instrumentation";
import { DEFAULT_WORKFLOW_NAME } from "./instrumentation/common/constants";

// Run once per process (tsx spawns helpers that each inherit --import).
const REGISTERED = Symbol.for("monocle2ai.register.done");
const g = globalThis as any;

if (!g[REGISTERED]) {
  g[REGISTERED] = true;

  setupMonocle(process.env.MONOCLE_WORKFLOW_NAME ?? DEFAULT_WORKFLOW_NAME);

  // Hold the loop briefly on exit so a short script's batched spans flush
  // before it exits (MONOCLE_FLUSH_MS, default 6000). Only affects real exit.
  let held = false;
  process.on("beforeExit", () => {
    if (held) return;
    held = true;
    setTimeout(() => {}, Number(process.env.MONOCLE_FLUSH_MS ?? 6000));
  });
}

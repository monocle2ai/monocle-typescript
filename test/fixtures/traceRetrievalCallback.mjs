// Loaded through the gate's dynamic-import path in traceReturnGate.test.ts.
// A real module on disk, because initTraceRetrievalCallback() resolves a
// runtime specifier — there is nothing for vi.mock to intercept.

export function allowAll() { return true; }

export function denyAll() { return false; }

export function boom() { throw new Error("nope"); }

// Async on purpose: the gate must refuse this rather than trust its Promise.
export async function asyncCheck() { return true; }

export const notAFunction = 42;

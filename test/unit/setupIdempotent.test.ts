import { describe, it, expect, afterEach } from 'vitest';
import { setupMonocle } from '../../src/instrumentation/common/instrumentation';

const INSTRUMENTOR = Symbol.for('monocle2ai.instrumentor');

// Running an already-instrumented file under `monocle2ai run` calls
// setupMonocle twice: once from the preload, once from the file's own injected
// setup. Without a guard that builds two tracer providers and every span is
// exported twice.
describe('setupMonocle is idempotent', () => {
  afterEach(() => {
    delete (globalThis as any)[INSTRUMENTOR];
  });

  it('returns the existing instrumentor instead of setting up again', () => {
    const first = setupMonocle('workflow-one');
    const second = setupMonocle('workflow-two');

    expect(second).toBe(first);
  });

  it('leaves the first setup in place on the global', () => {
    const first = setupMonocle('workflow-one');
    setupMonocle('workflow-two');

    expect((globalThis as any)[INSTRUMENTOR]).toBe(first);
  });

  it('sets up normally when nothing has been set up yet', () => {
    const only = setupMonocle('workflow-one');

    expect(only).toBeDefined();
    expect((globalThis as any)[INSTRUMENTOR]).toBe(only);
  });
});

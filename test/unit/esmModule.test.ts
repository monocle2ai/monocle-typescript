import { describe, it, expect, vi, beforeEach } from 'vitest';

const { registerMock } = vi.hoisted(() => ({ registerMock: vi.fn() }));
vi.mock('module', () => ({ register: registerMock }));

import { registerModule } from '../../src/instrumentation/common/esmModule';

/** The `data.exclude` patterns handed to import-in-the-middle. */
function excludePatterns(): RegExp[] {
  const call = registerMock.mock.calls[0];
  expect(call, 'register() was never called').toBeDefined();
  return call[2]?.data?.exclude ?? [];
}

const matches = (url: string) => excludePatterns().some((re) => re.test(url));

describe('registerModule - TypeScript sources are excluded from IITM', () => {
  beforeEach(() => {
    registerMock.mockClear();
    registerModule();
  });

  // Without this, IITM intercepts .ts files before Node strips their types,
  // and any TypeScript syntax reaches V8 raw as a SyntaxError.
  it('excludes .ts files', () => {
    expect(matches('file:///app/agent.ts')).toBe(true);
  });

  it('excludes .tsx files', () => {
    expect(matches('file:///app/page.tsx')).toBe(true);
  });

  it('excludes .mts files', () => {
    expect(matches('file:///app/agent.mts')).toBe(true);
  });

  it('excludes .cts files', () => {
    expect(matches('file:///app/agent.cts')).toBe(true);
  });

  it('excludes a .ts url carrying a query string', () => {
    expect(matches('file:///app/agent.ts?v=2')).toBe(true);
  });

  // The whole point of the hook is to wrap dependencies, which ship as .js.
  it('does NOT exclude .js files, which are what we need to wrap', () => {
    expect(matches('file:///app/node_modules/openai/index.js')).toBe(false);
  });

  it('does NOT exclude .mjs files', () => {
    expect(matches('file:///app/node_modules/openai/index.mjs')).toBe(false);
  });

  it('does NOT exclude .cjs files', () => {
    expect(matches('file:///app/node_modules/openai/index.cjs')).toBe(false);
  });

  it('does NOT exclude a package whose name merely contains ts', () => {
    expect(matches('file:///app/node_modules/ts-utils/index.js')).toBe(false);
  });

  it('still registers the import-in-the-middle hook', () => {
    expect(registerMock.mock.calls[0][0]).toBe('import-in-the-middle/hook.mjs');
  });
});

// openai v4 keeps its runtime shims in module-level state: _shims/index.mjs
// calls setShims() on _shims/registry.mjs, and core.mjs then reads it back.
// Wrapping those modules gives the writer and the reader different instances,
// so core.mjs sees an uninitialised registry and throws
// "you must `import 'openai/shims/node'` before importing anything else".
describe('registerModule - openai runtime shims are excluded', () => {
  beforeEach(() => {
    registerMock.mockClear();
    registerModule();
  });

  it('excludes the openai shims registry', () => {
    expect(matches('file:///app/node_modules/openai/_shims/registry.mjs')).toBe(true);
  });

  it('excludes the openai shims index', () => {
    expect(matches('file:///app/node_modules/openai/_shims/index.mjs')).toBe(true);
  });

  it('excludes the auto-runtime shim', () => {
    expect(matches('file:///app/node_modules/openai/_shims/auto/runtime.mjs')).toBe(true);
  });

  // The whole point of the hook is to wrap this one — excluding it would
  // silently disable OpenAI tracing.
  it('does NOT exclude the chat completions module we actually patch', () => {
    expect(matches('file:///app/node_modules/openai/resources/chat/completions.mjs')).toBe(false);
  });

  it('does NOT exclude openai core', () => {
    expect(matches('file:///app/node_modules/openai/core.mjs')).toBe(false);
  });

  it('does NOT exclude an unrelated package with shims in its path', () => {
    expect(matches('file:///app/node_modules/other/_shims/registry.mjs')).toBe(false);
  });
});

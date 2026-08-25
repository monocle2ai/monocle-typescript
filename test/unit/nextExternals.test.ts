import { describe, it, expect } from 'vitest';
import { getInstrumentedPackageNames } from '../../src/instrumentation/common/packages';
import {
  withMonocle,
  MONOCLE_INSTRUMENTED_PACKAGES,
  FRAMEWORK_COUPLED_PACKAGES,
} from '../../src/next';

describe('withMonocle default external list', () => {
  // Fails when a newly instrumented package isn't classified in src/next.ts,
  // so the curated list can't silently fall behind the metamodels.
  it('classifies every instrumented package as safe-default or framework-coupled', () => {
    const all = getInstrumentedPackageNames();
    const classified = new Set<string>([
      ...MONOCLE_INSTRUMENTED_PACKAGES,
      ...FRAMEWORK_COUPLED_PACKAGES,
    ]);
    const unclassified = all.filter((p) => !classified.has(p));
    expect(
      unclassified,
      `Instrumented package(s) not classified in src/next.ts: ${unclassified.join(', ')}. ` +
        `Add each to MONOCLE_INSTRUMENTED_PACKAGES (safe to externalize) or ` +
        `FRAMEWORK_COUPLED_PACKAGES (excluded from the default).`
    ).toEqual([]);
  });

  it('does not put framework-coupled packages in the safe default list', () => {
    for (const pkg of FRAMEWORK_COUPLED_PACKAGES) {
      expect(MONOCLE_INSTRUMENTED_PACKAGES).not.toContain(pkg);
    }
  });

  it('derives a non-empty instrumented package list from the metamodels', () => {
    expect(getInstrumentedPackageNames().length).toBeGreaterThan(0);
    // spot-check a couple of known instrumented packages
    expect(getInstrumentedPackageNames()).toContain('@mastra/core');
    expect(getInstrumentedPackageNames()).toContain('openai');
  });
});

describe('withMonocle config merge', () => {
  it('externalizes the chain + defaults + user extras, deduped', () => {
    const cfg = withMonocle(
      { serverExternalPackages: ['@mastra/core', 'my-lib'] },
      { externalPackages: ['@mastra/core', '@mastra/ai-sdk'] }
    );
    const ext: string[] = cfg.serverExternalPackages;
    // chain
    expect(ext).toContain('import-in-the-middle');
    expect(ext).toContain('monocle2ai');
    // safe default
    expect(ext).toContain('openai');
    // user's own + extra
    expect(ext).toContain('my-lib');
    expect(ext).toContain('@mastra/ai-sdk');
    // deduped (listed in both the base config and the option)
    expect(ext.filter((p) => p === '@mastra/core')).toHaveLength(1);
  });

  it('includeInstrumentedDefaults:false drops the curated defaults but keeps the chain', () => {
    const cfg = withMonocle({}, { includeInstrumentedDefaults: false });
    expect(cfg.serverExternalPackages).toContain('import-in-the-middle');
    expect(cfg.serverExternalPackages).not.toContain('openai');
  });

  it('preserves a user-provided webpack hook', () => {
    let called = false;
    const cfg = withMonocle({
      webpack: (config: any) => {
        called = true;
        return config;
      },
    });
    cfg.webpack({}, { isServer: true });
    expect(called).toBe(true);
  });
});

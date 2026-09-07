import { describe, it, expect } from 'vitest';
import { missingTsxMessage } from '../../src/cli';

describe('missingTsxMessage', () => {
  const message = () => missingTsxMessage('src/scripts/run-agent.ts');

  it('names the file that needs tsx', () => {
    expect(message()).toContain('run-agent.ts');
  });

  it('tells the user how to install tsx', () => {
    expect(message()).toContain('npm install -D tsx');
  });

  // The CLI is the one interface users should learn. Sending them to the raw
  // preload here taught them a second, lower-level way to do the same thing.
  it('points back at the same monocle2ai command rather than a raw preload', () => {
    expect(message()).toContain('monocle2ai run src/scripts/run-agent.ts');
  });

  it('does not leak the --import preload flag as an alternative interface', () => {
    expect(message()).not.toContain('--import');
  });

  it('does not suggest invoking the register entry directly', () => {
    expect(message()).not.toContain('monocle2ai/register');
  });
});

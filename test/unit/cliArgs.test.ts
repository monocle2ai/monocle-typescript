import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli/args';

describe('parseArgs', () => {
  it('parses a run command with a target file', () => {
    const parsed = parseArgs(['run', 'agent.ts']);

    expect(parsed).toMatchObject({ command: 'run', file: 'agent.ts', userArgs: [] });
  });

  it('keeps arguments after the file for the target script', () => {
    const parsed = parseArgs(['run', 'agent.ts', '--query', 'hello']);

    expect(parsed.userArgs).toEqual(['--query', 'hello']);
  });

  it('does not treat the target script own flags as monocle flags', () => {
    const parsed = parseArgs(['run', 'agent.ts', '--tsx']);
    expect(parsed.userArgs).toEqual(['--tsx']);
  });


  it('reports a run with no file as an error', () => {
    expect(parseArgs(['run']).command).toBe('error');
  });

  it('treats --help as help', () => {
    expect(parseArgs(['--help']).command).toBe('help');
  });

  it('treats no arguments as help', () => {
    expect(parseArgs([]).command).toBe('help');
  });

  it('treats --version as version', () => {
    expect(parseArgs(['--version']).command).toBe('version');
  });

  it('reports an unknown command as an error rather than guessing', () => {
    const parsed = parseArgs(['frobnicate', 'agent.ts']);

    expect(parsed.command).toBe('error');
    expect(parsed.message).toContain('frobnicate');
  });

  it('passes a -- separator through to the script without consuming it', () => {
    const parsed = parseArgs(['run', 'agent.ts', '--', '--tsx']);

    expect(parsed.userArgs).toEqual(['--', '--tsx']);
  });
});

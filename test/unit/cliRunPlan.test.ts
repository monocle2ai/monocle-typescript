import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  preloadFlagFor,
  projectDirFor,
  buildRunPlan,
  findTsxEntry,
  findNpxCli,
  resolveRunnerCommand,
} from '../../src/cli/runPlan';

let root: string;
const write = (rel: string, body = '') => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'monocle-cli-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('preloadFlagFor', () => {
  // tsx compiles the target whatever its module system, so the flag no longer
  // depends on the package type or the file's own syntax — only on .cts, which
  // import-in-the-middle cannot load through --import.
  it.each(['agent.ts', 'agent.tsx', 'agent.js', 'agent.mjs', 'agent.mts', 'agent.cjs'])(
    'uses the import preload for %s',
    (f) => {
      expect(preloadFlagFor(f)).toBe('--import');
    }
  );

  it('uses the require preload for .cts, which breaks IITM under --import', () => {
    expect(preloadFlagFor('agent.cts')).toBe('--require');
  });

  it('ignores the case of the extension', () => {
    expect(preloadFlagFor('AGENT.CTS')).toBe('--require');
  });

  it('does not depend on the file contents', () => {
    // A path that does not exist still yields a flag — nothing is read.
    expect(preloadFlagFor('/nowhere/agent.ts')).toBe('--import');
  });
});

describe('projectDirFor', () => {
  it('returns the directory holding the nearest package.json', () => {
    write('package.json', '{}');
    const file = write('src/agent.ts');

    expect(projectDirFor(file)).toBe(root);
  });

  it('prefers a nested package.json over one further up', () => {
    write('package.json', '{}');
    write('packages/api/package.json', '{}');
    const file = write('packages/api/src/agent.ts');

    expect(projectDirFor(file)).toBe(path.join(root, 'packages/api'));
  });

  it("falls back to the file's own directory when there is no package.json", () => {
    const file = path.join(root, 'loose', 'agent.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');

    expect(projectDirFor(file)).toBe(path.join(root, 'loose'));
  });
});

describe('buildRunPlan', () => {
  it('preloads tracing ahead of the target file', () => {
    write('package.json', '{}');
    const file = write('agent.ts', 'const a: string = "x";');

    expect(buildRunPlan(file, []).args).toEqual([
      '--import',
      'monocle2ai/register',
      file,
    ]);
  });

  it('runs from the project directory, so tsconfig and node_modules resolve', () => {
    write('package.json', '{}');
    const file = write('src/agent.ts');

    expect(buildRunPlan(file, []).cwd).toBe(root);
  });

  it('passes the user arguments after the script, so the target sees its own argv', () => {
    write('package.json', '{}');
    const file = write('agent.ts');

    expect(buildRunPlan(file, ['--query', 'hello world']).args).toEqual([
      '--import',
      'monocle2ai/register',
      file,
      '--query',
      'hello world',
    ]);
  });

  it('uses the require preload for a .cts target', () => {
    write('package.json', '{}');
    const file = write('agent.cts', 'const a = require("a");');

    expect(buildRunPlan(file, []).args[0]).toBe('--require');
  });

  it('resolves a relative path, since the child runs from the project directory', () => {
    write('package.json', '{}');
    write('agent.ts');
    const plan = buildRunPlan(path.join(root, '.', 'agent.ts'), []);

    expect(path.isAbsolute(plan.args[2])).toBe(true);
  });

  // Every module system and TypeScript feature goes through the same plan —
  // these all failed on plain node before, and the runner no longer varies.
  it.each([
    ['enum syntax node cannot strip', 'agent.ts', 'enum Level { Low }'],
    ['an explicitly-commonjs file using export', 'agent.ts', 'const a = require("a");\nexport {};'],
    ['a pure ESM file', 'agent.ts', 'import a from "a";'],
    ['plain JavaScript', 'agent.js', 'const a = require("a");'],
  ])('handles %s without a separate runner decision', (_label, name, body) => {
    write('package.json', '{}');
    const file = write(name, body);

    expect(buildRunPlan(file, []).args[0]).toBe('--import');
  });
});

const installTsx = (bin: unknown = './dist/cli.mjs') => {
  write(`node_modules/tsx/package.json`, JSON.stringify({ name: 'tsx', bin }));
  return write(`node_modules/tsx/dist/cli.mjs`, '// tsx');
};

describe('findTsxEntry', () => {
  it('resolves the JS entry point of the installed tsx package', () => {
    const entry = installTsx();

    expect(findTsxEntry(root)).toBe(entry);
  });

  // node_modules/.bin holds shell shims, and Windows ships tsx.cmd there.
  // Node refuses to spawn a .cmd without a shell, so the entry must be a plain
  // JS file we can hand to the node binary ourselves.
  it('never returns a shim from node_modules/.bin', () => {
    installTsx();
    write('node_modules/.bin/tsx.cmd', '@echo off');
    write('node_modules/.bin/tsx', '#!/bin/sh');

    expect(findTsxEntry(root)).toMatch(/dist[\\/]cli\.mjs$/);
  });

  it('walks up to a hoisted tsx, as module resolution does', () => {
    const entry = installTsx();
    const nested = path.join(root, 'packages/api');
    fs.mkdirSync(nested, { recursive: true });

    expect(findTsxEntry(nested)).toBe(entry);
  });

  it('reads the object form of the bin field', () => {
    const entry = installTsx({ tsx: './dist/cli.mjs' });

    expect(findTsxEntry(root)).toBe(entry);
  });

  it('returns undefined when tsx is nowhere up the tree', () => {
    expect(findTsxEntry(root)).toBeUndefined();
  });

  it('returns undefined when the manifest points at a file that is not there', () => {
    write('node_modules/tsx/package.json', JSON.stringify({ bin: './dist/cli.mjs' }));

    expect(findTsxEntry(root)).toBeUndefined();
  });

  it('returns undefined when the manifest cannot be parsed', () => {
    write('node_modules/tsx/package.json', 'not json');

    expect(findTsxEntry(root)).toBeUndefined();
  });
});

describe('findNpxCli', () => {
  it('finds npx-cli.js beside the node binary, the layout Windows installs use', () => {
    const cli = write('nodedir/node_modules/npm/bin/npx-cli.js', '// npx');

    expect(findNpxCli(path.join(root, 'nodedir/node.exe'))).toBe(cli);
  });

  it('finds npx-cli.js under lib, the layout POSIX installs use', () => {
    const cli = write('lib/node_modules/npm/bin/npx-cli.js', '// npx');

    expect(findNpxCli(path.join(root, 'bin/node'))).toBe(cli);
  });

  it('returns undefined when npm is not installed beside node', () => {
    expect(findNpxCli(path.join(root, 'bin/node'))).toBeUndefined();
  });
});

describe('resolveRunnerCommand', () => {
  const posix = '/usr/bin/node';
  const win = 'C:\\nodejs\\node.exe';

  it('runs the tsx entry through the node binary already running', () => {
    const entry = installTsx();

    expect(resolveRunnerCommand(root, posix)).toEqual({
      bin: posix,
      prefixArgs: [entry],
      usedNpx: false,
    });
  });

  // The reported bug: Node >= 18.20.2 returns EINVAL rather than spawning a
  // .cmd without a shell, and EINVAL is thrown rather than emitted.
  it('spawns no .cmd shim on Windows when tsx is installed', () => {
    installTsx();
    write('node_modules/.bin/tsx.cmd', '@echo off');

    const command = resolveRunnerCommand(root, win);

    expect(command.bin).toBe(win);
    expect([command.bin, ...command.prefixArgs].join(' ')).not.toMatch(/\.(cmd|bat)$/im);
  });

  it("falls back to npm's own npx-cli.js through node, which needs no shell", () => {
    const cli = write('nodedir/node_modules/npm/bin/npx-cli.js', '// npx');
    const execPath = path.join(root, 'nodedir/node.exe');

    expect(resolveRunnerCommand(root, execPath)).toEqual({
      bin: execPath,
      prefixArgs: [cli, '--yes', 'tsx'],
      usedNpx: true,
    });
  });

  // Last resort: npx is on PATH as a shell script on POSIX, so this still works
  // there; on Windows it fails, and the CLI turns that into install guidance.
  it('falls back to the npx command when npm cannot be located beside node', () => {
    expect(resolveRunnerCommand(root, posix)).toEqual({
      bin: 'npx',
      prefixArgs: ['--yes', 'tsx'],
      usedNpx: true,
    });
  });

  it('reports whether the fallback is in use so the CLI can say so', () => {
    expect(resolveRunnerCommand(root, posix).usedNpx).toBe(true);

    installTsx();
    expect(resolveRunnerCommand(root, posix).usedNpx).toBe(false);
  });
});

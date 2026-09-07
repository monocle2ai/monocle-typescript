import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runOnce } from '../../src/cli';
import { buildRunPlan } from '../../src/cli/runPlan';

let root: string;
const write = (rel: string, body = '') => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'monocle-run-'));
  write('package.json', '{}');
  write('node_modules/tsx/package.json', JSON.stringify({ bin: './dist/cli.mjs' }));
  write('node_modules/tsx/dist/cli.mjs', '// tsx');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('runOnce', () => {
  // Node emits only EACCES/EAGAIN/EMFILE/ENFILE/ENOENT as 'error' events and
  // throws every other spawn failure. On Windows that throw is EINVAL for .cmd
  // files; ENOTDIR reproduces the same class here, through a path whose parent
  // is a file. Unguarded it escapes the executor as a raw Node stack, which is
  // why the reported failure showed no Monocle message at all.
  it('reports a spawn failure that Node throws instead of emitting', async () => {
    const file = write('agent.ts', 'export {};');

    const outcome = await runOnce(buildRunPlan(file, []), '/etc/hosts/node');

    expect(outcome.code).toBe(1);
    expect(outcome.spawnError).toMatch(/ENOTDIR/);
  });

  it('does not reject, so the CLI can turn the failure into guidance', async () => {
    const file = write('agent.ts', 'export {};');

    await expect(
      runOnce(buildRunPlan(file, []), '/etc/hosts/node')
    ).resolves.toBeDefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadMonocleEnvFile, MONOCLE_ENV_FILE } from '../../src/common/envFile';

let root: string;
let savedEnv: NodeJS.ProcessEnv;

const writeEnvFile = (body: string) =>
  fs.writeFileSync(path.join(root, MONOCLE_ENV_FILE), body);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'monocle-envfile-'));
  savedEnv = { ...process.env };
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  // Restore in place: reassigning process.env swaps Node's special env object
  // for a plain one, and loadEnvFile then writes where nothing can read it.
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

describe('loadMonocleEnvFile', () => {
  it('puts the settings it reads on process.env', () => {
    writeEnvFile('MONOCLE_EXPORTER=file\nMONOCLE_WORKFLOW_NAME=my-agent\n');

    expect(loadMonocleEnvFile(root)).toBe('loaded');
    expect(process.env.MONOCLE_EXPORTER).toBe('file');
    expect(process.env.MONOCLE_WORKFLOW_NAME).toBe('my-agent');
  });

  // This file is where Monocle's settings live, so it is authoritative. It
  // has to override: the preload runs in every process tsx spawns, and only
  // the last of them applies --env-file, so leaving set variables alone made
  // .env win under plain node and lose under tsx for the very same project.
  it('overrides a variable that is already set', () => {
    process.env.MONOCLE_EXPORTER = 'okahu';
    writeEnvFile('MONOCLE_EXPORTER=file\nMONOCLE_DEBUG=true\n');

    loadMonocleEnvFile(root);

    expect(process.env.MONOCLE_EXPORTER).toBe('file');
    expect(process.env.MONOCLE_DEBUG).toBe('true');
  });

  it('leaves variables the file does not mention alone', () => {
    process.env.MONOCLE_DEBUG = 'true';
    writeEnvFile('MONOCLE_EXPORTER=file\n');

    loadMonocleEnvFile(root);

    expect(process.env.MONOCLE_DEBUG).toBe('true');
  });

  // Parsed with Node's own rules, so this file and --env-file never disagree
  // about what a line means.
  it('parses the file the way --env-file does', () => {
    writeEnvFile('export MONOCLE_EXPORTER=file\n# a comment\nMONOCLE_FILE_PREFIX="two words"\n');

    loadMonocleEnvFile(root);

    expect(process.env.MONOCLE_EXPORTER).toBe('file');
    expect(process.env.MONOCLE_FILE_PREFIX).toBe('two words');
  });

  it('reads the file beside the directory it is given, not the process cwd', () => {
    writeEnvFile('MONOCLE_WORKFLOW_NAME=from-dir\n');

    loadMonocleEnvFile(root);

    expect(process.env.MONOCLE_WORKFLOW_NAME).toBe('from-dir');
  });

  // Most projects will never have this file; that is not a problem to report.
  it('reports an absent file without throwing', () => {
    expect(loadMonocleEnvFile(root)).toBe('absent');
  });

  // Tracing must never fail because this optional file cannot be read.
  it('reports a file it cannot read without throwing', () => {
    fs.mkdirSync(path.join(root, MONOCLE_ENV_FILE));

    expect(loadMonocleEnvFile(root)).toBe('failed');
  });

  it('defaults to the process cwd', () => {
    expect(() => loadMonocleEnvFile()).not.toThrow();
  });
});

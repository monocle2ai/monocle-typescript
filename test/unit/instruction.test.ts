import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { instructionInEffect, loadInstruction } from '../../src/instructions/instruction';
import { MONOCLE_INSTRUCTION_ENV } from '../../src/instrumentation/common/constants';
import { setupMonocle } from '../../src/instrumentation/common/instrumentation';

const INSTRUMENTOR = Symbol.for('monocle2ai.instrumentor');

let dir: string;
let savedValue: string | undefined;

const writeInstruction = (fileName: string, body: string) => {
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, body);
  return file;
};

const HOUSE_STYLE = [
  'name: house-style',
  'description: Keeps answers short.',
  'instruction: |',
  '  Answer in three sentences or fewer.',
  '',
].join('\n');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monocle-instruction-'));
  savedValue = process.env[MONOCLE_INSTRUCTION_ENV];
  delete process.env[MONOCLE_INSTRUCTION_ENV];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (savedValue === undefined) delete process.env[MONOCLE_INSTRUCTION_ENV];
  else process.env[MONOCLE_INSTRUCTION_ENV] = savedValue;
});

describe('loadInstruction', () => {
  it('reads the name and the trimmed instruction text', () => {
    const file = writeInstruction('house-style.yaml', HOUSE_STYLE);

    expect(loadInstruction(file)).toEqual({
      name: 'house-style',
      text: 'Answer in three sentences or fewer.',
    });
  });

  it('accepts a .yml file', () => {
    const file = writeInstruction('house-style.yml', HOUSE_STYLE);

    expect(loadInstruction(file).name).toBe('house-style');
  });

  it('throws, naming the file, when the file is missing', () => {
    const file = path.join(dir, 'absent.yaml');

    expect(() => loadInstruction(file)).toThrow(`Instruction file ${file} was not found.`);
  });

  it('throws when the file is not a mapping', () => {
    const file = writeInstruction('house-style.yaml', '- just\n- a list\n');

    expect(() => loadInstruction(file)).toThrow('must hold a name, a description and an instruction');
  });

  it('throws when the YAML does not parse', () => {
    const file = writeInstruction('house-style.yaml', 'name: [unclosed\n');

    expect(() => loadInstruction(file)).toThrow(file);
  });

  it.each(['name', 'description', 'instruction'])('throws when "%s" is missing or blank', (key) => {
    const fields: Record<string, string> = {
      name: 'house-style',
      description: 'Keeps answers short.',
      instruction: 'Be brief.',
      [key]: '"  "',
    };
    const body = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
    const file = writeInstruction('house-style.yaml', body);

    expect(() => loadInstruction(file)).toThrow(`has no '${key}'`);
  });

  it('throws when the name does not match the file name', () => {
    const file = writeInstruction('other-name.yaml', HOUSE_STYLE);

    expect(() => loadInstruction(file)).toThrow("is named 'house-style'");
  });

  it('reads the file once per path', () => {
    const file = writeInstruction('house-style.yaml', HOUSE_STYLE);
    const first = loadInstruction(file);
    fs.writeFileSync(file, HOUSE_STYLE.replace('three', 'two'));

    expect(loadInstruction(file)).toBe(first);
  });
});

describe('instructionInEffect', () => {
  it('returns null when the variable is not set', () => {
    expect(instructionInEffect()).toBeNull();
  });

  it('returns null when the variable is blank', () => {
    process.env[MONOCLE_INSTRUCTION_ENV] = '  ';

    expect(instructionInEffect()).toBeNull();
  });

  it('loads the file the variable points to', () => {
    process.env[MONOCLE_INSTRUCTION_ENV] = writeInstruction('house-style.yaml', HOUSE_STYLE);

    expect(instructionInEffect()?.name).toBe('house-style');
  });

  it('throws when the variable points to a bad file', () => {
    process.env[MONOCLE_INSTRUCTION_ENV] = path.join(dir, 'absent.yaml');

    expect(() => instructionInEffect()).toThrow('was not found');
  });
});

describe('setupMonocle with an instruction', () => {
  afterEach(() => {
    delete (globalThis as any)[INSTRUMENTOR];
  });

  it('stops startup when the instruction file is bad', () => {
    process.env[MONOCLE_INSTRUCTION_ENV] = path.join(dir, 'absent.yaml');

    expect(() => setupMonocle('instruction-app')).toThrow('was not found');
    expect((globalThis as any)[INSTRUMENTOR]).toBeUndefined();
  });

  it('sets up when the instruction file is valid', () => {
    process.env[MONOCLE_INSTRUCTION_ENV] = writeInstruction('house-style.yaml', HOUSE_STYLE);

    expect(setupMonocle('instruction-app')).toBeDefined();
  });
});

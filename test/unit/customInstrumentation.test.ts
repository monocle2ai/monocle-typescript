import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadCustomInstrumentation } from '../../src/instrumentation/common/customInstrumentation';

const ENV = 'MONOCLE_CUSTOM_INSTRUMENTATION_FILE_PATH';

let cwd: string;
let warn: ReturnType<typeof vi.spyOn>;

function writeFile(rel: string, content: string) {
    const file = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return fs.realpathSync(file);
}

function writeConfig(yaml: string, dir = '.monocle') {
    writeFile(path.join(dir, 'custom_instrumentation.yaml'), yaml);
}

beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monocle-custom-'));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    delete process.env[ENV];
});

afterEach(() => {
    warn.mockRestore();
    delete process.env[ENV];
    fs.rmSync(cwd, { recursive: true, force: true });
});

describe('loadCustomInstrumentation', () => {
    it('returns nothing, silently, when there is no config file', () => {
        expect(loadCustomInstrumentation(cwd)).toEqual([]);
        expect(warn).not.toHaveBeenCalled();
    });

    it('turns an entry into a method config with the custom span processor', () => {
        const file = writeFile('src/bookingService.ts', '');
        writeConfig(`
instrument:
  - package: ./src/bookingService.ts
    class: BookingService
    method: reserveSeat
    span_name: travel.reserveSeat
`);

        const [entry] = loadCustomInstrumentation(cwd);

        expect(entry).toMatchObject({
            package: file,
            object: 'BookingService',
            method: 'reserveSeat',
            spanName: 'travel.reserveSeat',
        });
        expect(entry.output_processor[0].type).toBe('custom');
    });

    it('resolves a path written without its extension or as a folder', () => {
        const ts = writeFile('src/svc.ts', '');
        const index = writeFile('src/lib/index.js', '');
        writeConfig(`
instrument:
  - { package: ./src/svc, class: Svc, method: run }
  - { package: ./src/lib, method: run }
`);

        expect(loadCustomInstrumentation(cwd).map(e => e.package)).toEqual([ts, index]);
    });

    it('keeps an npm package name as it is', () => {
        writeConfig(`
instrument:
  - { package: some-sdk, class: Client, method: send }
`);

        expect(loadCustomInstrumentation(cwd)[0].package).toBe('some-sdk');
    });

    it('allows leaving out class to wrap an exported function', () => {
        writeFile('src/fares.js', '');
        writeConfig(`
instrument:
  - { package: ./src/fares.js, method: quoteFare }
`);

        const [entry] = loadCustomInstrumentation(cwd);

        expect(entry.object).toBe('');
        expect(entry.spanName).toBeUndefined();
    });

    it('applies exclude to the processor', () => {
        writeFile('src/pay.js', '');
        writeConfig(`
instrument:
  - { package: ./src/pay.js, class: Pay, method: charge, exclude: [inputs] }
`);

        const events = loadCustomInstrumentation(cwd)[0].output_processor[0].events.map((e: any) => e.name);

        expect(events).toEqual(['data.output']);
    });

    it('skips, with a warning, entries missing package or method', () => {
        writeConfig(`
instrument:
  - { class: Pay, method: charge }
  - { package: some-sdk, class: Client }
`);

        expect(loadCustomInstrumentation(cwd)).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('skips, with a warning, a project file that does not exist', () => {
        writeConfig(`
instrument:
  - { package: ./src/missing, class: Pay, method: charge }
`);

        expect(loadCustomInstrumentation(cwd)).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('./src/missing'));
    });

    it('warns and loads nothing when the YAML is invalid', () => {
        writeConfig('instrument: [unclosed');

        expect(loadCustomInstrumentation(cwd)).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it('reads the folder named by MONOCLE_CUSTOM_INSTRUMENTATION_FILE_PATH', () => {
        writeConfig(`
instrument:
  - { package: some-sdk, class: Client, method: send }
`, 'config/tracing');
        process.env[ENV] = 'config/tracing';

        expect(loadCustomInstrumentation(cwd)).toHaveLength(1);
    });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { InMemorySpanExporter, SimpleSpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { setupMonocle } from '../../src/instrumentation/common/instrumentation';

// End to end for CommonJS: a config file names methods in project files, and
// requiring those files after setupMonocle traces them.

const INSTRUMENTOR = Symbol.for('monocle2ai.instrumentor');
const ENV = 'MONOCLE_CUSTOM_INSTRUMENTATION_FILE_PATH';

let dir: string;
let memExporter: InMemorySpanExporter;
let instrumentor: any;
let warn: ReturnType<typeof vi.spyOn>;

function write(rel: string, content: string) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
}

// Relative paths resolve from process.cwd() (the repo here), so ./ becomes the temp dir.
function setup(yaml: string) {
    write('.monocle/custom_instrumentation.yaml', yaml.replaceAll('./', dir + '/'));
    process.env[ENV] = path.join(dir, '.monocle');
    memExporter = new InMemorySpanExporter();
    instrumentor = setupMonocle('custom-config-test', [new SimpleSpanProcessor(memExporter)]);
}

const load = (rel: string) => createRequire(__filename)(path.join(dir, rel));

function spanNamed(name: string): ReadableSpan {
    const span = memExporter.getFinishedSpans().find(s => s.name === name);
    if (!span) throw new Error(`expected a span named ${name}`);
    return span;
}

const eventAttrs = (span: ReadableSpan, name: string) => span.events.find(e => e.name === name)?.attributes;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monocle-hooks-'));
    process.env.MONOCLE_DISABLE_HOOK_AUDIT = 'true';
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    write('src/booking.js', `
class BookingService {
  reserveSeat(from, to) { return { pnr: 'PNR-' + from + to }; }
}
function quoteFare(from, to) { return Promise.resolve({ fare: 422 }); }
module.exports = { BookingService, quoteFare };
`);
});

afterEach(() => {
    instrumentor?.disable();
    instrumentor = undefined;
    delete (globalThis as any)[INSTRUMENTOR];
    delete process.env[ENV];
    delete process.env.MONOCLE_DISABLE_HOOK_AUDIT;
    warn.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('custom instrumentation config (CommonJS)', () => {
    it('traces a class method named in the config', () => {
        setup(`
instrument:
  - { package: ./src/booking, class: BookingService, method: reserveSeat, span_name: travel.reserveSeat }
`);
        const { BookingService } = load('src/booking.js');

        expect(new BookingService().reserveSeat('SFO', 'BOM')).toEqual({ pnr: 'PNR-SFOBOM' });

        const span = spanNamed('travel.reserveSeat');
        expect(span.attributes['span.type']).toBe('custom');
        expect(eventAttrs(span, 'data.input')).toEqual({ input: '{"args":["SFO","BOM"]}' });
        expect(eventAttrs(span, 'data.output')).toEqual({ response: '{"result":{"pnr":"PNR-SFOBOM"}}' });
    });

    it('traces an exported function when class is left out', async () => {
        setup(`
instrument:
  - { package: ./src/booking.js, method: quoteFare }
`);
        const { quoteFare } = load('src/booking.js');

        await quoteFare('SFO', 'BOM');

        const span = memExporter.getFinishedSpans().find(s => s.attributes['span.type'] === 'custom');
        expect(span && eventAttrs(span, 'data.output')).toEqual({ response: '{"result":{"fare":422}}' });
    });

    it('warns, and leaves the module working, when the class is not exported', () => {
        setup(`
instrument:
  - { package: ./src/booking.js, class: BookingSvc, method: reserveSeat }
`);

        const { BookingService } = load('src/booking.js');

        expect(new BookingService().reserveSeat('A', 'B')).toEqual({ pnr: 'PNR-AB' });
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/reserveSeat.*booking\.js.*traceMethod/s));
    });

    it('warns when an export cannot be replaced', () => {
        write('src/readonly.js', `
function quoteFare() { return 1; }
Object.defineProperty(exports, 'quoteFare', { enumerable: true, get: () => quoteFare });
`);
        setup(`
instrument:
  - { package: ./src/readonly.js, method: quoteFare }
`);

        expect(load('src/readonly.js').quoteFare()).toBe(1);
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/quoteFare.*readonly\.js.*traceMethod/s));
    });

    it('reports entries whose file was never loaded', () => {
        setup(`
instrument:
  - { package: ./src/booking.js, class: BookingService, method: reserveSeat }
`);

        instrumentor.auditCustomInstrumentation();

        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/never loaded.*booking\.js/s));
    });

    it('does not report entries whose file was loaded', () => {
        setup(`
instrument:
  - { package: ./src/booking.js, class: BookingService, method: reserveSeat }
`);
        load('src/booking.js');

        instrumentor.auditCustomInstrumentation();

        expect(warn).not.toHaveBeenCalled();
    });
});

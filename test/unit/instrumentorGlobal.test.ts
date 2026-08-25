import { describe, it, expect, afterEach } from 'vitest';
import { setInstrumentor, startTraceInternal } from '../../src/instrumentation/common/utils';

// The instrumentor must live on globalThis, not module scope. A `--import`
// preload loads the ESM build while a later require() loads the CJS build, so
// each copy has its own module state; a module-scoped instrumentor left
// startTrace() silently emitting nothing from the copy that didn't set it.
const INSTRUMENTOR = Symbol.for('monocle2ai.instrumentor');

function fakeInstrumentor() {
    const spans: string[] = [];
    return {
        spans,
        getTracer: () => ({
            startActiveSpan: (name: string, cb: any) => {
                spans.push(name);
                return cb({
                    setAttribute() {}, addEvent() {}, setStatus() {}, end() {},
                    spanContext: () => ({ traceId: 't', spanId: 's' }),
                });
            },
        }),
    };
}

describe('instrumentor is shared across module copies', () => {
    afterEach(() => { delete (globalThis as any)[INSTRUMENTOR]; });

    it('setInstrumentor publishes on a well-known global symbol', () => {
        const inst = fakeInstrumentor();
        setInstrumentor(inst);
        expect((globalThis as any)[INSTRUMENTOR]).toBe(inst);
    });

    // The cross-copy case: another copy of the package set the instrumentor,
    // so this copy never ran setInstrumentor itself.
    it('startTrace uses an instrumentor published by a different copy', () => {
        const inst = fakeInstrumentor();
        (globalThis as any)[INSTRUMENTOR] = inst;

        let ran = false;
        startTraceInternal(() => { ran = true; return 'done'; });

        expect(ran).toBe(true);
        expect(inst.spans).toEqual(['workflow']); // a span was actually emitted
    });

    it('still runs the function when no instrumentor is set anywhere', () => {
        let ran = false;
        const out = startTraceInternal(() => { ran = true; return 'fallback'; });
        expect(ran).toBe(true);
        expect(out).toBe('fallback');
    });
});

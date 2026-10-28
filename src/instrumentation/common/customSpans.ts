import { Attributes, trace } from "@opentelemetry/api";
import { getInstrumentor } from "./utils";
import { getPatchedMain } from "./wrapper";
import { buildCustomSpanProcessor, CustomSpanExclude } from "./customSpanProcessor";

const DEFAULT_SPAN_NAME = "custom_span";

export interface TraceMethodOptions {
    spanName?: string;
    exclude?: CustomSpanExclude;
}

export interface MonocleTraceOptions {
    attributes?: Attributes;
    events?: { name: string, attributes?: Attributes }[];
}

// Runs fn through the regular wrapper. The tracer is read per call, so code
// wrapped before setupMonocle is still traced once setup runs. Function names
// here are listed in MONOCLE_INTERNAL_FRAME_NAMES so span.source skips them.
function monocleRunInSpan(element: Record<string, any>, fn: Function, thisArg: any, args: any[]) {
    const tracer = getInstrumentor()?.getTracer();
    if (!tracer) return fn.apply(thisArg, args);
    return getPatchedMain({ package: "", object: "", method: "", ...element, tracer })(fn).apply(thisArg, args);
}

// Wraps a function so each call is a custom span with its input and output.
export function traceMethod<F extends (...args: any[]) => any>(fn: F, options: TraceMethodOptions = {}): F {
    const element = {
        method: fn.name,
        spanName: options.spanName || fn.name || DEFAULT_SPAN_NAME,
        output_processor: [buildCustomSpanProcessor(options.exclude)],
    };
    return function monocleTracedMethod(this: any, ...args: any[]) {
        return monocleRunInSpan(element, fn, this, args);
    } as F;
}

// Method decorator. Works with both standard (TC39) and legacy
// (experimentalDecorators) decorators. The span name defaults to the method name.
export function monocleTraceMethod(options: TraceMethodOptions = {}) {
    return function (target: any, contextOrKey?: any, descriptor?: PropertyDescriptor): any {
        if (descriptor && typeof descriptor.value === "function") {
            const spanName = options.spanName || String(contextOrKey);
            return { ...descriptor, value: traceMethod(descriptor.value, { ...options, spanName }) };
        }
        if (typeof target === "function") {
            const spanName = options.spanName || String(contextOrKey?.name ?? target.name);
            return traceMethod(target, { ...options, spanName });
        }
        return descriptor;
    };
}

// Wraps a block of code in a span. Records only the given attributes and
// events, not input or output.
export function monocleTrace<T>(spanName: string | undefined, fn: () => T, options: MonocleTraceOptions = {}): T {
    const element = {
        spanName: spanName || DEFAULT_SPAN_NAME,
        output_processor: [{ type: "custom", attributes: [] }],
    };
    const block = () => {
        const span = trace.getActiveSpan();
        if (options.attributes) span?.setAttributes(options.attributes);
        options.events?.forEach(event => span?.addEvent(event.name, event.attributes));
        return fn();
    };
    return monocleRunInSpan(element, block, undefined, []);
}

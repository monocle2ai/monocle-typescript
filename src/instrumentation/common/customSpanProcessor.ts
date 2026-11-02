import { getExceptionStatusCode } from "../metamodel/utils";

// Output processor for user methods: records args as data.input and the
// return value as data.output. Same span shape as Python's custom spans.

const MAX_DEPTH = 3;
const MAX_ITEMS = 100;

export const EXCLUDE_INPUTS = "inputs";
export const EXCLUDE_OUTPUTS = "outputs";
const VALID_EXCLUSIONS = [EXCLUDE_INPUTS, EXCLUDE_OUTPUTS];

export type CustomSpanExclude = string | string[];

// Makes a value JSON-safe. Depth and size limits keep large or circular
// objects from blowing up the span.
export function serializeValue(value: any, depth = 0): any {
    if (value === undefined || value === null) return null;
    if (["string", "number", "boolean"].includes(typeof value)) return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (value instanceof Date) return value.toISOString();
    if (depth >= MAX_DEPTH) return String(value);
    if (Array.isArray(value)) {
        return value.slice(0, MAX_ITEMS).map(v => serializeValue(v, depth + 1));
    }
    if (typeof value === "object") {
        const result: Record<string, any> = {};
        for (const [key, v] of Object.entries(value).slice(0, MAX_ITEMS)) {
            result[key] = serializeValue(v, depth + 1);
        }
        return result;
    }
    return String(value);
}

function extractInput({ args }: { args: any }): string {
    try {
        return JSON.stringify({ args: Array.from(args || [], v => serializeValue(v)) });
    } catch (e) {
        console.warn(`Failed to capture custom span input: ${e}`);
        return JSON.stringify({ error: "Failed to capture input" });
    }
}

function extractOutput({ response, exception }: { response: any, exception: any }): string {
    // No output on failure; error_code carries it.
    if (exception) return "";
    // The wrapper reports a consumed async generator as { events, type }.
    const result = response?.type === "async_generator" ? response.events : response;
    try {
        return JSON.stringify({ result: serializeValue(result) });
    } catch (e) {
        console.warn(`Failed to capture custom span output: ${e}`);
        return JSON.stringify({ error: "Failed to capture output" });
    }
}

function getErrorCode({ exception }: { exception: any }): string {
    return exception ? getExceptionStatusCode({ exception }) : "";
}

// Accepts "inputs", "outputs" or a list of them, in any case. Unknown names
// are warned about and ignored, so a typo never breaks the traced app.
export function normalizeExclusions(exclude?: CustomSpanExclude): Set<string> {
    const excluded = new Set<string>();
    if (!exclude) return excluded;
    for (const item of Array.isArray(exclude) ? exclude : [exclude]) {
        const name = String(item).trim().toLowerCase();
        if (VALID_EXCLUSIONS.includes(name)) {
            excluded.add(name);
        } else {
            console.warn(`Ignoring unknown custom span exclusion '${item}'; expected one of ${VALID_EXCLUSIONS.join(", ")}`);
        }
    }
    return excluded;
}

// Excluded data is never read. error_code is always kept so a span with
// outputs excluded can still show that the call failed.
export function buildCustomSpanProcessor(exclude?: CustomSpanExclude) {
    const excluded = normalizeExclusions(exclude);
    const events = [];

    if (!excluded.has(EXCLUDE_INPUTS)) {
        events.push({
            name: "data.input",
            attributes: [{ attribute: "input", accessor: extractInput }],
        });
    }

    const outputAttributes: any[] = [{ attribute: "error_code", accessor: getErrorCode }];
    if (!excluded.has(EXCLUDE_OUTPUTS)) {
        outputAttributes.push({ attribute: "response", accessor: extractOutput });
    }
    events.push({ name: "data.output", attributes: outputAttributes });

    // Empty attributes keeps the span handler from warning on every span.
    return { type: "custom", attributes: [], events };
}

export const CUSTOM_SPAN_PROCESSOR = buildCustomSpanProcessor();

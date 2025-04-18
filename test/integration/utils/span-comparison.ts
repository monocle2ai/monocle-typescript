import { SpanExport } from '../../../dist/src/exporters/utils'

export const cleanSpan = (span: SpanExport): Partial<SpanExport> => {
    const cleaned = JSON.parse(JSON.stringify(span));
    delete cleaned.context.trace_id;
    delete cleaned.context.span_id;
    delete cleaned.parent_id;
    delete cleaned.start_time;
    delete cleaned.end_time;

    if (cleaned.events) {
        cleaned.events = cleaned.events.map(event => {
            const cleanedEvent = { ...event };
            delete cleanedEvent.timestamp;
            if (cleanedEvent.attributes) {
                if (cleanedEvent.attributes.input) delete cleanedEvent.attributes.input;
                if (cleanedEvent.attributes.response) delete cleanedEvent.attributes.response;
            }
            return cleanedEvent;
        });
    }
    if (cleaned.attributes) {
        if (cleaned.attributes["monocle_apptrace.version"]) delete cleaned.attributes["monocle_apptrace.version"];
    }
    return cleaned;
};

export const sortSpans = (spans: SpanExport[]): SpanExport[] => {
    return [...spans].sort((a, b) => {
        if (a.name === b.name) {
            return Object.keys(a.attributes).length  > Object.keys(b.attributes).length ? 1 : -1;
        }
        return a.name > b.name ? 1 : -1;
    });
};
import { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { exportInfo, SpanExport } from './utils';

// Same shape as the Python SDK's SpanFilter config, in camelCase.
export interface SpanFilterConfig {
    // Span types to keep, matched against `span.type`. Supports wildcards: "inference.*".
    spanTypesToInclude?: string[];
    fieldsToInclude?: {
        // Attribute keys to keep, e.g. ["entity.1.type", "scope.*"]. Omit to keep all.
        attributes?: string[];
        // Events to keep by name, optionally projected to some of their attributes. Omit to keep all.
        events?: Array<{ name: string; attributes?: string[] }>;
    };
    // "include" (default) keeps the listed span types, "exclude" drops them.
    mode?: "include" | "exclude";
}

export type FilteredSpan = Pick<
    SpanExport,
    "name" | "context" | "kind" | "parent_id" | "start_time" | "end_time" | "status" | "attributes" | "events" | "resource"
>;

export class SpanFilter {
    private spanTypesToInclude: string[];
    private attributePatterns: string[];
    private eventConfigs: Array<{ name: string; attributes?: string[] }>;
    private mode: "include" | "exclude";

    constructor(config: SpanFilterConfig) {
        this.spanTypesToInclude = config.spanTypesToInclude || [];
        this.attributePatterns = config.fieldsToInclude?.attributes || [];
        this.eventConfigs = config.fieldsToInclude?.events || [];
        this.mode = config.mode || "include";
        if (this.mode !== "include" && this.mode !== "exclude") {
            throw new Error("mode must be 'include' or 'exclude'");
        }
    }

    shouldIncludeSpan(span: ReadableSpan): boolean {
        if (this.spanTypesToInclude.length === 0) {
            return true;
        }
        const spanType = String(span.attributes["span.type"] ?? "");
        if (this.spanTypesToInclude.some(pattern => matchesPattern(spanType, pattern))) {
            return this.mode === "include";
        }
        return this.mode === "exclude";
    }

    // Projects the span to the configured fields, or returns null if its type is filtered out.
    filter(span: ReadableSpan): FilteredSpan | null {
        if (!this.shouldIncludeSpan(span)) {
            return null;
        }
        const spanObject = this._exportInfo(span);
        return {
            name: spanObject.name,
            context: spanObject.context,
            kind: spanObject.kind,
            parent_id: spanObject.parent_id,
            start_time: spanObject.start_time,
            end_time: spanObject.end_time,
            status: spanObject.status,
            attributes: this._filterAttributes(spanObject.attributes || {}),
            events: this._filterEvents(spanObject.events || []),
            resource: spanObject.resource,
        };
    }

    private _exportInfo(span): SpanExport {
        return exportInfo(span);
    }

    private _filterAttributes(attributes: Record<string, any>): Record<string, any> {
        if (this.attributePatterns.length === 0) {
            return attributes;
        }
        return pickMatching(attributes, this.attributePatterns);
    }

    private _filterEvents(events: SpanExport["events"]): SpanExport["events"] {
        if (this.eventConfigs.length === 0) {
            return events;
        }
        const filtered: SpanExport["events"] = [];
        for (const event of events) {
            const eventConfig = this.eventConfigs.find(config => matchesPattern(event.name || "", config.name));
            if (!eventConfig) {
                continue;
            }
            if (!eventConfig.attributes) {
                filtered.push(event);
                continue;
            }
            filtered.push({
                name: event.name,
                timestamp: event.timestamp,
                attributes: pickMatching(event.attributes || {}, eventConfig.attributes),
            });
        }
        return filtered;
    }
}

function pickMatching(values: Record<string, any>, patterns: string[]): Record<string, any> {
    const picked: Record<string, any> = {};
    for (const pattern of patterns) {
        for (const key of Object.keys(values)) {
            if (!(key in picked) && matchesPattern(key, pattern)) {
                picked[key] = values[key];
            }
        }
    }
    return picked;
}

function matchesPattern(value: string, pattern: string): boolean {
    if (pattern === "*") {
        return true;
    }
    if (!pattern.includes("*")) {
        return value === pattern;
    }
    if (pattern.endsWith(".*")) {
        return value.startsWith(pattern.slice(0, -2));
    }
    if (pattern.startsWith("*.")) {
        return value.endsWith(pattern.slice(2));
    }
    const regex = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${regex}$`).test(value);
}

import { format } from "date-fns";
import { hrTimeToTimeStamp } from "@opentelemetry/core";
import { Span } from "@opentelemetry/sdk-trace-node";

// Generates S3 exporter time format: "%Y-%m-%d__%H.%M.%S"
export function getS3FormattedTime(date = new Date()) {
  return format(date, "yyyy-MM-dd'__'HH.mm.ss");
}

// Generates Azure Blob exporter time format: "%Y-%m-%d_%H.%M.%S"
export function getBlobFormattedTime(date = new Date()) {
  return format(date, "yyyy-MM-dd'_'HH.mm.ss");
}

export interface SpanExport {
  name: string;
  context: {
    trace_id: string;
    span_id: string;
    trace_flags: number;
    trace_state: any;
  };
  kind: number;
  parent_id: string;
  start_time: string;
  end_time: string;
  status: {
    status_code: string;
    description?: string;
  };
  attributes: Record<string, any>;
  events: Array<{
    name: string;
    timestamp?: string;
    time?: any;
    attributes?: Record<string, any>;
  }>;
  links: Array<any>;
  resource: {
    attributes: {
      "service.name": string;
    }
  };
}

export function exportInfo(span: Span) {
  const span_object: SpanExport = {
    name: span.name,
    context: {
      trace_id: span.spanContext().traceId,
      span_id: span.spanContext().spanId,
      trace_flags: span.spanContext().traceFlags,
      trace_state: span.spanContext().traceState,
    },
    kind: span.kind,
    parent_id: span?.parentSpanContext?.spanId || null,
    start_time: convertTimestamp(hrTimeToTimeStamp(span.startTime)),
    end_time: convertTimestamp(hrTimeToTimeStamp(span.endTime)),
    status: {
      status_code: span.status.code === 2 ? "ERROR" : "OK",
      description: span.status.message || "",
    },
    attributes: span.attributes,
    events: span.events,
    links: span.links,
    resource: {
      attributes: {
        // ...span.resource.attributes,
        "service.name": span.resource.attributes.SERVICE_NAME as string,
      }
    },
  };

  if (span_object.events && span_object.events.length > 0) {
    //@ts-ignore
    // Have to ingore type because we need the timestamp field instead if time field to maintain consistency with python sdk
    span_object.events = span_object.events.map(event => {
      return {
        name: event?.name,
        timestamp: convertTimestamp(hrTimeToTimeStamp(event.time)),
        attributes: event?.attributes
      }
    });
  }
  return span_object;
}

function convertTimestamp(timestamp: string): string {
  const date = new Date(timestamp);

  // Get the milliseconds part
  const ms = date.getUTCMilliseconds();

  // Format the main part of the date
  const mainPart = date.toISOString().split('.')[0];

  // Format microseconds (6 digits)
  const microseconds = ms.toString().padStart(3, '0') + '000';

  return `${mainPart}.${microseconds}Z`;
}
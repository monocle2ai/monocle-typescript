import { format } from "date-fns";
import { hrTimeToTimeStamp } from "@opentelemetry/core";
import { Span } from "@opentelemetry/sdk-trace-node";

export function getUrlFriendlyTime(date = new Date()) {
  return format(date, "yyyyMMdd'T'HHmmss");
}

// generate random alphanumeric string of given length
export function makeid(length) {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
}

export function exportInfo(span: Span) {
  const span_object = {
    name: span.name,
    context: {
      trace_id: span.spanContext().traceId,
      span_id: span.spanContext().spanId,
      trace_flags: span.spanContext().traceFlags,
      trace_state: span.spanContext().traceState,
    },
    kind: span.kind,
    parent_id: span.parentSpanId,
    start_time: convertTimestamp(hrTimeToTimeStamp(span.startTime)),
    end_time: convertTimestamp(hrTimeToTimeStamp(span.endTime)),
    status: span.status,
    attributes: span.attributes,
    events: span.events,
    links: span.links,
    resource: {
      attributes: {
        // ...span.resource.attributes,
        "service.name": span.resource.attributes.SERVICE_NAME,
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
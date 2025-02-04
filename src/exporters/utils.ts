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
    start_time: hrTimeToTimeStamp(span.startTime),
    end_time: hrTimeToTimeStamp(span.endTime),
    status: span.status,
    attributes: span.attributes,
    events: span.events,
    links: span.links,
    resource: {
      attributes: span.resource.attributes,
    },
  };
  
  if (span_object.events && span_object.events.length > 0) {
    //@ts-ignore
    span_object.events = span_object.events.map(event => {
      return {
        name: event?.name,
        time: hrTimeToTimeStamp(event.time),
        attributes: event?.attributes
      }
    });
  }
  return span_object;
}
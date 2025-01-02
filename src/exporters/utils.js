const { format } = require("date-fns")
const { hrTimeToTimeStamp } = require("@opentelemetry/core");


exports.getUrlFriendlyTime = function getUrlFriendlyTime(date = new Date()) {
  return format(date, "yyyyMMdd'T'HHmmss");
}

// generate random alphanumeric string of given length
exports.makeid = function makeid(length) {
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

exports.exportInfo = function exportInfo(span) {
  const span_object = {
    name: span.name,
    context: span.spanContext(),
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
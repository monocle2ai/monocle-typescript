import { SPAN_TYPES } from "../../../common/constants";
import {
    getMethod, getParams, getRequestBody, getResponseBody, getRoute, getStatusCode, getUrl,
} from "../../../http/capture";

// Entity accessors receive `output` for the response, event accessors receive
// `response` - different shapes for the same object. Using the wrong one yields
// a silently empty attribute, so the two halves below are not interchangeable.
export const HTTP_PROCESS = {
    "type": SPAN_TYPES.HTTP_PROCESS,
    "attributes": [
        [
            {
                "_comment": "request method",
                "attribute": "method",
                "accessor": function ({ instance }: any) {
                    return getMethod(instance);
                },
            },
            {
                "_comment": "matched route template when a framework supplied one, else the path",
                "attribute": "route",
                "accessor": function ({ instance }: any) {
                    return getRoute(instance);
                },
            },
            {
                "_comment": "full request URL, query string included",
                "attribute": "url",
                "accessor": function ({ instance }: any) {
                    return getUrl(instance);
                },
            },
        ],
    ],
    "events": [
        {
            "name": "data.input",
            "attributes": [
                {
                    "_comment": "raw query string, unparsed, as monocle_apptrace emits it",
                    "attribute": "params",
                    "accessor": function ({ instance }: any) {
                        return getParams(instance);
                    },
                },
                {
                    "_comment": "request body, present only when a body parser populated req.body",
                    "attribute": "request_body",
                    "accessor": function ({ instance }: any) {
                        return getRequestBody(instance);
                    },
                },
            ],
        },
        {
            "name": "data.output",
            "attributes": [
                {
                    "_comment": "HTTP status as a string, matching monocle_apptrace",
                    "attribute": "status_code",
                    "accessor": function ({ response }: any) {
                        return getStatusCode(response);
                    },
                },
                {
                    "_comment": "response body accumulated by the server hook's write patches",
                    "attribute": "response",
                    "accessor": function ({ response }: any) {
                        return getResponseBody(response);
                    },
                },
            ],
        },
    ],
};

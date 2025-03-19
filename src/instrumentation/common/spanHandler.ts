import { service_name_map, service_type_map, WORKFLOW_TYPE_GENERIC, WORKFLOW_TYPE_KEY_SYMBOL, WrapperArguments } from "./constants";
// import { setScopes } from "./instrumentation";
import { getScopesInternal } from "./utils";
import { context, Span, SpanStatusCode } from "@opentelemetry/api";
import { MONOCLE_VERSION } from './monocle_version';

export interface SpanHandler {
    preProcessSpan({ span, instance, args, element }: {
        span: Span;
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }): void;

    skipSpan({ instance, args, element }: {
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }): boolean;

    postProcessSpan({ span, instance, args, returnValue, outputProcessor }: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
    }): void;

    processSpan({ span, instance, args, returnValue, outputProcessor, wrappedPackage }: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
        wrappedPackage: string;
    }): void;

    preTracing(element: WrapperArguments): void;
}

const isRootSpan = function (span) {
    if (typeof span.parentSpanId === "string" && span.parentSpanId.length > 0)
        return false
    return true;
};

const setSpanStatus = function (span) {
    if (span.status.code == SpanStatusCode.UNSET) {
        span.setStatus({
            code: SpanStatusCode.OK,
            message: "OK"
        })
    }
};
const WORKFLOW_TYPE_MAP = {
    "llamaindex": "workflow.llamaindex",
    "langchain": "workflow.langchain",
    "haystack": "workflow.haystack"
}

function getWorkflowName(span) {
    try {
        return span.resource.attributes["SERVICE_NAME"];
    } catch (e) {
        console.error(`Error getting workflow name: ${e}`);
        return `workflow.${span.context.traceId}`;
    }
}

function _IsPlainObject(obj: any) {
    return typeof obj === 'object' &&
        Object.keys(obj).length > 0 &&
        Object.keys(obj).every(key => typeof key === 'string') &&
        Object.values(obj).every(value => typeof value === 'string' || typeof value === 'number');
}

export class DefaultSpanHandler implements SpanHandler {
    skipSpan({ element }: {
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }): boolean {
        if (element.spanType === "workflow" && isWorkflowSpanActive()) {
            return true;
        }
        return false;
    }

    preTracing(_: WrapperArguments): void {

    }

    preProcessSpan({
        span,
        element
    }: {
        span: Span;
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }) {
        DefaultSpanHandler.setMonocleAttributes(span);
        if (isRootSpan(span)) {
            DefaultSpanHandler.setWorkflowAttributes({ wrappedPackage: element.package, span });
            DefaultSpanHandler.setAppHostingIdentifierAttribute(span);
        }
        // spanIndex += setAppHostingIdentifierAttribute(span, spanIndex);

    }

    postProcessSpan({span }: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
    }) {
        setSpanStatus(span);
    }

    processSpan({ span, instance, args, returnValue, outputProcessor }: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
        wrappedPackage: string;
    }) {
        let spanIndex = 1;

        if (isRootSpan(span)) {
            spanIndex = 3
        }

        if (outputProcessor && outputProcessor[0]) {
            outputProcessor = outputProcessor[0];
            if (typeof outputProcessor === 'object' && Object.keys(outputProcessor).length > 0) {
                if (outputProcessor.type) {
                    span.setAttribute("span.type", outputProcessor.type);
                } else {
                    console.warn("type of span not found or incorrect written in entity json");
                }

                if (outputProcessor.attributes) {

                    outputProcessor.attributes.forEach((processors: any) => {
                        let attributeSet = false;
                        processors.forEach((processor: any) => {
                            const attribute = processor['attribute'];
                            const accessor = processor['accessor'];

                            if (attribute && accessor) {
                                const attributeName = `entity.${spanIndex}.${attribute}`;
                                try {
                                    const accessor_args = { instance: instance, args: args, output: returnValue };
                                    if (typeof accessor === 'function') {
                                        const result = accessor(accessor_args);
                                        if (result) {
                                            attributeSet = true;
                                            span.setAttribute(attributeName, result);
                                        }
                                    }

                                } catch (e) {
                                    console.error(`Error processing accessor: ${e}`);
                                }
                            } else {
                                console.warn(`${['attribute', 'accessor'].filter(key => !processor[key]).join(' and ')} not found or incorrect in entity JSON`);
                            }
                        });
                        attributeSet && spanIndex++;
                    });
                } else {
                    console.warn("attributes not found or incorrect written in entity json");
                }

                if (outputProcessor.events) {
                    const events = outputProcessor.events;
                    const accessorMapping = {
                        "args": args,
                        "response": returnValue,
                        "instance": instance
                    };

                    events.forEach((event: any) => {
                        const eventName = event.name;
                        const eventAttributes: Record<string, any> = {};
                        const attributes = event.attributes || [];

                        attributes.forEach((attribute: any) => {
                            const attributeKey = attribute.attribute;
                            const accessor = attribute.accessor;

                            if (typeof accessor === 'function') {
                                try {
                                    const accessorFunction = accessor;
                                    const accessorResponse = accessorFunction(accessorMapping);
                                    if (accessorResponse) {
                                        if (attributeKey) {
                                            eventAttributes[attributeKey] = accessorResponse;
                                        }
                                        else if (_IsPlainObject(accessorResponse)) {
                                            Object.assign(eventAttributes, accessorResponse);
                                        }
                                    }
                                } catch (e) {
                                    console.error(`Error evaluating accessor for attribute '${attributeKey}': ${e}`);
                                }
                            }
                        });

                        span.addEvent(eventName, eventAttributes);
                    });
                }
            } else {
                console.warn("empty or entities json is not in correct format");
            }
        }
        if (spanIndex > 1) {
            span.setAttribute("entity.count", spanIndex - 1);
        }
    }

    // executeFunction<T>(element: WrapperArguments, fn: () => T): T {
    //     console.log("Executing function with wrapper arguments:", element.method);
    //     // Demonstrate we can do something before calling the function

    //     return setScopes({ "a": "b" }, () => {
    //         // Call the function and return its result
    //         return fn();
    //     });
    // }

    public static setWorkflowAttributes({ wrappedPackage, span }: {
        wrappedPackage?: string;
        span: Span;
    }) {
        let spanAttributeIndex = 1;
        let workflowName: string = getWorkflowName(span)
        if (workflowName) {
            span.setAttribute("span.type", "workflow");
            span.setAttribute(`entity.${spanAttributeIndex}.name`, workflowName);
        }
        let currentWorkflowType = getWorkflowType(wrappedPackage);

        span.setAttribute(`entity.${spanAttributeIndex}.type`, currentWorkflowType);
    }

    public static setAppHostingIdentifierAttribute(span: Span): void {
        const spanIndex = 2;
        
        // Search env to identify the infra service type, if found check env for service name if possible
        span.setAttribute(`entity.${spanIndex}.type`, `app_hosting.generic`);
        span.setAttribute(`entity.${spanIndex}.name`, "generic");
        
        for (const [typeEnv, typeName] of Object.entries(service_type_map)) {
          if (process.env[typeEnv]) {
            span.setAttribute(`entity.${spanIndex}.type`, `app_hosting.${typeName}`);
            const entityNameEnv = service_name_map[typeName] || "unknown";
            span.setAttribute(`entity.${spanIndex}.name`, process.env[entityNameEnv] || "generic");
          }
        }
      }

    public static setMonocleAttributes(span: Span) {
        span.setAttribute("monocle-typescript.version", MONOCLE_VERSION);
        const scopes = getScopesInternal();
        for (const scopeKey in scopes) {
            span.setAttribute(`scope.${scopeKey}`, scopes[scopeKey]);
        }
    }
}

export class NonFrameworkSpanHandler extends DefaultSpanHandler {

    skipSpan({ }: {
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }): boolean {
        const currentActiveWorkflowType = context.active().getValue(WORKFLOW_TYPE_KEY_SYMBOL) || WORKFLOW_TYPE_GENERIC;
        return Object.values(WORKFLOW_TYPE_MAP).includes(currentActiveWorkflowType as string);
    }

}

function getWorkflowType(wrappedPackage: string) {
    let currentWorkflowType = WORKFLOW_TYPE_GENERIC;
    for (let [packageName, workflowType] of Object.entries(WORKFLOW_TYPE_MAP)) {
        if (wrappedPackage && wrappedPackage.includes(packageName)) {
            currentWorkflowType = workflowType;
        }
    }
    return currentWorkflowType;
}

export function attachWorkflowType(element?: WrapperArguments) {
    let activeContext = context.active();
    let currentWorkflowType = activeContext.getValue(WORKFLOW_TYPE_KEY_SYMBOL);
    if (!element) {
        activeContext = activeContext.setValue(WORKFLOW_TYPE_KEY_SYMBOL, WORKFLOW_TYPE_GENERIC);
        return activeContext;
    }
    if (!currentWorkflowType || currentWorkflowType === WORKFLOW_TYPE_GENERIC) {
        if (element.spanType === "workflow") {
            activeContext = context.active().setValue(WORKFLOW_TYPE_KEY_SYMBOL, getWorkflowType(element?.package));
        }
    }

    return activeContext;
}

function isWorkflowSpanActive() {
    return typeof context.active().getValue(WORKFLOW_TYPE_KEY_SYMBOL) === "string";
}

export function isNonWorkflowRootSpan(curr_span: Span, element: WrapperArguments) {
    return isRootSpan(curr_span) && element.spanType !== "workflow";
}



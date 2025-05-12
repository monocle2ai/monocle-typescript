import { MONOCLE_SDK_LANGUAGE, MONOCLE_SDK_VERSION, service_name_map, service_type_map, WORKFLOW_TYPE_GENERIC, WORKFLOW_TYPE_KEY_SYMBOL, WrapperArguments } from "./constants";
// import { setScopes } from "./instrumentation";
import { getScopesInternal } from "./utils";
import { context, SpanStatusCode } from "@opentelemetry/api";
import { Span } from "./opentelemetryUtils";
import { MONOCLE_VERSION } from './monocle_version';
import { consoleLog } from "../../common/logging";
export interface SpanHandler {
    setDefaultMonocleAttributes({ span, instance, args, element, sourcePath }: {
        span: Span;
        instance: any;
        args: IArguments;
        element: WrapperArguments;
        sourcePath: any;
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
        sourcePath: string;
    }): void;

    skipProcessor({ instance, args, element }: {
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }): boolean;

    setWorkflowProperties({ span, element }: {
        span: Span;
        instance: any;
        args: IArguments;
        element: WrapperArguments;
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

export function isRootSpan(span: Span) {
    if (typeof span?.parentSpanContext?.spanId === "string" && span?.parentSpanContext?.spanId?.length > 0)
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
    "haystack": "workflow.haystack",
    "@microsoft/teams-ai": "workflow.microsoft_teams_ai"
}

function getWorkflowName(span: Span) {
    try {
        return span.resource.attributes["SERVICE_NAME"] as string;
    } catch (e) {
        console.error(`Error getting workflow name: ${e}`);
        return `workflow.${span.spanContext().traceId}`;
    }
}

function _IsPlainObject(obj: any) {
    return typeof obj === 'object' &&
        Object.keys(obj).length > 0 &&
        Object.keys(obj).every(key => typeof key === 'string') &&
        Object.values(obj).every(value => typeof value === 'string' || typeof value === 'number');
}

export class DefaultSpanHandler implements SpanHandler {
    skipProcessor({ }: {
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }): boolean {
        return false
    }

    skipSpan({ element }: {
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }): boolean {
        // check if workflow span is active and if the element is a workflow span and it is not root span by using context
        if (isWorkflowSpanActive() && element.spanType === "workflow") {
            return true;
        }
        return false;
    }

    preTracing(_: WrapperArguments): void {

    }

    setDefaultMonocleAttributes({
        span, sourcePath
    }: {
        span: Span;
        instance: any;
        args: IArguments;
        element: WrapperArguments;
        sourcePath: string;
    }) {
        DefaultSpanHandler.setMonocleAttributes(span, sourcePath);
    }

    setWorkflowProperties({ span, element }: {
        span: Span;
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }) {
        DefaultSpanHandler.setWorkflowAttributes({ wrappedPackage: element.package, span });
        DefaultSpanHandler.setAppHostingIdentifierAttribute(span);
    }

    postProcessSpan({ span }: {
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

        if (!this.skipProcessor({ instance, args, element: null }) && outputProcessor && outputProcessor[0]) {
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
        else {
            span.setAttribute("span.type", "generic");
        }
        if (spanIndex > 1) {
            span.setAttribute("entity.count", spanIndex - 1);
        }
    }

    public static setWorkflowAttributes({ wrappedPackage, span }: {
        wrappedPackage?: string;
        span: Span;
    }) {
        let spanAttributeIndex = 1;
        let workflowName: string = getWorkflowName(span)
        if (workflowName) {
            span.setAttribute("span.type", "workflow");
            span.updateName("workflow");
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

    public static setMonocleAttributes(span: Span, sourcePath) {
        span.setAttribute(MONOCLE_SDK_VERSION, MONOCLE_VERSION);
        span.setAttribute(MONOCLE_SDK_LANGUAGE, "js");
        if (sourcePath) {
            consoleLog("sourcePath", sourcePath);
            span.setAttribute("span.source", sourcePath);
        }
        const workflowName = getWorkflowName(span);
        span.setAttribute("workflow.name", workflowName);
        const scopes = getScopesInternal();
        for (const scopeKey in scopes) {
            span.setAttribute(`scope.${scopeKey}`, scopes[scopeKey]);
        }
    }
}



export class NonFrameworkSpanHandler extends DefaultSpanHandler {

    skipProcessor({ }: {
        instance: any;
        args: IArguments;
        element: WrapperArguments;
    }): boolean {
        return this.checkActiveWorkflowType();
    }



    protected checkActiveWorkflowType() {
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
        activeContext = context.active().setValue(WORKFLOW_TYPE_KEY_SYMBOL, getWorkflowType(element?.package));
    }

    return activeContext;
}

function isWorkflowSpanActive() {
    return typeof context.active().getValue(WORKFLOW_TYPE_KEY_SYMBOL) === "string";
}




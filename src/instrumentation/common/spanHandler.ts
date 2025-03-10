import { WrapperArguments } from "./constants";
import { setScopes } from "./instrumentation";
import { getScopesInternal } from "./utils";
import { Span } from "@opentelemetry/api";

export interface SpanHandler {
    preProcessSpan({ span, instance, args, outputProcessor }: {
        span: Span;
        instance: any;
        args: IArguments;
        outputProcessor: any;
    }): void;

    executeFunction?<T>(element: WrapperArguments, fn: () => T): T;

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
    preTracing(_: WrapperArguments): void {

    }

    preProcessSpan({ span, instance, args, outputProcessor }: {
        span: Span;
        instance: any;
        args: IArguments;
        outputProcessor: any;
    }) {
        const sdkVersion = "0.0.1"
        span.setAttribute("monocle-typescript.version", sdkVersion)
        const scopes = getScopesInternal()
        for (const scopeKey in scopes) {
            span.setAttribute(`scope.${scopeKey}`, scopes[scopeKey])
        }
        if (outputProcessor) {
            outputProcessor(
                {
                    returnValue: undefined,
                    arguments: args,
                    classInstance: instance,
                    span
                })
        }
    }

    postProcessSpan({ span, instance, args, returnValue, outputProcessor }: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
    }) {
        if (typeof outputProcessor === "function") {
            outputProcessor(
                {
                    returnValue,
                    args,
                    classInstance: instance,
                    span
                })
        }
    }

    processSpan({ span, instance, args, returnValue, outputProcessor, wrappedPackage }: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
        wrappedPackage: string;
    }) {
        let spanIndex = 1;

        if (isRootSpan(span)) {
            spanIndex += this.setWorkflowAttributes({ wrappedPackage, span, spanIndex });
            // spanIndex += setAppHostingIdentifierAttribute(span, spanIndex);
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

    private setWorkflowAttributes({ wrappedPackage, span, spanIndex }: {
        wrappedPackage: string;
        span: Span;
        spanIndex: number;
    }): number {
        let returnValue = 1;
        let workflowName = getWorkflowName(span);
        if (workflowName) {
            span.setAttribute("span.type", "workflow");
            span.setAttribute(`entity.${spanIndex}.name`, workflowName);
        }
        let workflowTypeSet = false;
        for (let [packageName, workflowType] of Object.entries(WORKFLOW_TYPE_MAP)) {
            if (wrappedPackage !== undefined && wrappedPackage.includes(packageName)) {
                span.setAttribute(`entity.${spanIndex}.type`, workflowType);
                workflowTypeSet = true;
            }
        }
        if (!workflowTypeSet) {
            span.setAttribute(`entity.${spanIndex}.type`, "workflow.generic");
        }
        return returnValue;
    }
}

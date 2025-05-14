import { context, Tracer } from "@opentelemetry/api";
import { getSourcePath, setScopesInternal } from "./utils";
import { attachWorkflowType, DefaultSpanHandler, isRootSpan, SpanHandler } from "./spanHandler";
import { ADD_NEW_WORKFLOW_SYMBOL, WrapperArguments } from "./constants";
import { consoleLog } from "../../common/logging";
import { Span } from "./opentelemetryUtils";


export function getPatchedMain({ tracer, spanHandler, ...element }: WrapperArguments) {
    return function (original: Function) {
        return function (this: any, ...args: IArguments[]) {            
            return tracer.startActiveSpan(element.spanName || element.method, (span: Span) => {
                const sourcePath = getSourcePath();
                try {
                    const handler = spanHandler || new DefaultSpanHandler();
                    const elementWithTracer: WrapperArguments = { 
                        ...element, 
                        tracer,
                        sourcePath 
                    };

                    handler.setDefaultMonocleAttributes({ 
                        span, 
                        instance: this, 
                        args: arguments,  // Use arguments instead of args
                        element: elementWithTracer,
                        sourcePath 
                    });

                    if (!handler.skipSpan({ 
                        instance: this, 
                        args: arguments, 
                        element: elementWithTracer 
                    })) {
                        const currentContext = attachWorkflowType(elementWithTracer);
                        
                        return context.with(currentContext, () => {
                            const result = original.apply(this, args);
                            
                            if (result && typeof result.then === 'function') {
                                return result
                                    .then((value: any) => {
                                        handler.postProcessSpan({ 
                                            span, 
                                            instance: this, 
                                            args: arguments,
                                            returnValue: value, 
                                            outputProcessor: element.output_processor,
                                            sourcePath
                                        });
                                        span.end();
                                        return value;
                                    })
                                    .catch((error: Error) => {
                                        span.setStatus({
                                            code: 2,
                                            message: error?.message || "Error occurred"
                                        });
                                        span.end();
                                        throw error;
                                    });
                            } else {
                                handler.postProcessSpan({ 
                                    span, 
                                    instance: this, 
                                    args: arguments,
                                    returnValue: result, 
                                    outputProcessor: element.output_processor,
                                    sourcePath
                                });
                                span.end();
                                return result;
                            }
                        });
                    }
                    else {
                        // Add preTracing call when span is skipped
                        handler.preTracing(elementWithTracer);
                        return original.apply(this, args);
                    }
                } catch (error) {
                    span.setStatus({
                        code: 2,
                        message: error?.message || "Error occurred"
                    });
                    span.end();
                    throw error;
                }
            });
        };
    };
}

export const getPatchedMainList = function (elements: WrapperArguments[]) {
    const spanHandler = new DefaultSpanHandler();
    return function mainMethodName(original: Function) {
        return function patchMainMethodName() {
            // If element is an array, we need to process multiple elements
            return processMultipleElementsWithTracing(this, elements, spanHandler, original, arguments);
        };
    };
}

export const getPatchedScopeMain = function ({ tracer, ...element }: { tracer: Tracer, spanName: string, package: string, object: string, method: string, output_processor: any, scopeName: string }) {
    return function mainMethodName(original: Function) {
        return function patchMainMethodName() {
            consoleLog(`calling scope wrapper ${element.scopeName}`);
            return setScopesInternal({ [element.scopeName]: null },
                context.active(),
                () => {
                    return original.apply(this, arguments);
                }
            )
        };
    };
}

function processMultipleElementsWithTracing(
    thisArg: () => any,
    elements: WrapperArguments[],
    spanHandler: SpanHandler,
    original: Function,
    args: any,
) {
    // Process elements recursively, creating nested spans
    return processElementsRecursively(thisArg, elements, 0, spanHandler, original, args);
}

function processElementsRecursively(
    thisArg: () => any,
    elements: WrapperArguments[],
    index: number,
    spanHandler: SpanHandler,
    original: Function,
    args: any
) {
    // Base case: if we've processed all elements, call the original function
    if (index >= elements.length) {
        return original.apply(thisArg, args);
    }

    // Process the current element and then recurse for the next element
    const currentElement = elements[index];
    const currentSpanHandler = currentElement.spanHandler || spanHandler;

    return processSpanWithTracing(
        thisArg,
        currentElement,
        currentSpanHandler,
        // Instead of calling original directly, we'll call a function that processes the next element
        function () {
            return processElementsRecursively(thisArg, elements, index + 1, spanHandler, original, args);
        },
        args,
        currentElement.sourcePath
    );
}

function processSpanWithTracing(
    thisArg: () => any,
    element: WrapperArguments,
    spanHandler: SpanHandler,
    original: Function,
    args: any,
    sourcePath: string
) {
    const tracer = element.tracer;
    let currentContext = context.active();
    const skipSpan = element.skipSpan || spanHandler.skipSpan({ instance: thisArg, args: args, element });
    if (!element.skipSpan) {
        currentContext = attachWorkflowType(element);
    }
    if (skipSpan) {
        spanHandler.preTracing(element);
        return original.apply(thisArg, args);
    }
    else {
        //add_workflow_span = get_value(ADD_NEW_WORKFLOW) == True
        const shouldAddWorkflowSpan = currentContext.getValue(ADD_NEW_WORKFLOW_SYMBOL) === true;
        currentContext = currentContext.setValue(ADD_NEW_WORKFLOW_SYMBOL, false);
        return context.with(currentContext, () => {
            return handleSpanProcess({ currentContext, tracer, element, spanHandler, thisArg, args, original, shouldAddWorkflowSpan, sourcePath });
        });
    }

}

function handleSpanProcess({ currentContext, tracer, element, spanHandler, thisArg, args, original, shouldAddWorkflowSpan, sourcePath }: { currentContext: any, tracer: Tracer, element: WrapperArguments, spanHandler: SpanHandler, thisArg: () => any, args: any, original: Function, shouldAddWorkflowSpan: boolean, sourcePath: string }) {
    let returnValue: any;


    return tracer.startActiveSpan(
        getSpanName(element),
        (span: Span) => {
            if (isRootSpan(span) || shouldAddWorkflowSpan) {
                spanHandler.setWorkflowProperties({ span, instance: thisArg, args: args, element });
                returnValue = handleSpanProcess({ currentContext, tracer, element, spanHandler, thisArg, args, original, shouldAddWorkflowSpan: false, sourcePath });
                span.updateName("workflow");
                if (typeof returnValue === 'object' && returnValue !== null && typeof returnValue.then === "function") {
                    returnValue.then(() => {
                        span.end();
                    }).catch(() => {
                        span.end();
                    });
                }
                else {
                    span.end();
                }
            }
            else {
                returnValue = original.apply(thisArg, args);
                if (typeof returnValue === 'object' && returnValue !== null && typeof returnValue.then === "function") {
                    returnValue.then((result: any) => {
                        postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue: result, element, args: args, sourcePath });
                    }).catch((error: any) => {
                        span.setStatus({ code: 2, message: error?.message || "Error occurred" });
                        postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue: error, element, args: args, sourcePath });
                    });
                }
                else {
                    postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue, element, args: args, sourcePath });
                }
            }

            spanHandler.setDefaultMonocleAttributes({ span: span, instance: thisArg, args: args, element: element, sourcePath: sourcePath });


            return returnValue;
        }
    );
}

function getSpanName(element: WrapperArguments): string {
    return element.spanName || (element.package || '' + element.object || '' + element.method || '');
}

function postProcessSpanData({ instance, spanHandler, span, returnValue, element, args, sourcePath }) {
    spanHandler.postProcessSpan({ span, instance: instance, args: args, returnValue, outputProcessor: null, sourcePath });
    spanHandler.processSpan({ span, instance: instance, args: args, outputProcessor: element.output_processor, returnValue, wrappedPackage: element.package, sourcePath });
    span.end();
}

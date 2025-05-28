import { context, Tracer, trace } from "@opentelemetry/api";
import { getSourcePath, setScopesInternal } from "./utils";
import { attachWorkflowType, DefaultSpanHandler, isRootSpan, SpanHandler } from "./spanHandler";
import { ADD_NEW_WORKFLOW_SYMBOL, MethodConfig, WrapperArguments } from "./constants";
import { consoleLog } from "../../common/logging";
import { Span } from "./opentelemetryUtils";

export const getPatchedMain = function (element: WrapperArguments) {
    const spanHandler: SpanHandler = element.spanHandler || new DefaultSpanHandler();
    return function mainMethodName(original: Function) {
        return function patchMainMethodName() {
            const sourcePathValue = getSourcePath();
            return processSpanWithTracing(this, element, spanHandler, original, arguments, sourcePathValue);
        };
    };
}

export const getPatchedMainList = function (elements: WrapperArguments[]) {
    const spanHandler = new DefaultSpanHandler();
    return function mainMethodName(original: Function) {
        return function patchMainMethodName() {
            const sourcePathValue = getSourcePath();
            // If element is an array, we need to process multiple elements
            return processMultipleElementsWithTracing(this, elements, spanHandler, original, arguments, sourcePathValue);
        };
    };
}

export const getPatchedScopeMain = function (element: MethodConfig) {
    return function mainMethodName(original: Function) {
        return function patchMainMethodName(...args: any[]) {
            consoleLog(`calling scope wrapper ${element.scopeName}`);
            let scopeName: string = element.scopeName;
            let scopeValue: string = null;
            let scopeValues: Record<string, string> = null;
            if (typeof element.scopeValue === "function") {
                try {
                    scopeValue = element.scopeValue(args);
                }
                catch (error) {
                    consoleLog(`Error in scopeValue function: ${error}`);
                }
            }
            if (typeof element.scopeValues === "object") {
                scopeValues = element.scopeValues;
            }
            if (typeof element.scopeValues === "function") {
                try {
                    scopeValues = element.scopeValues({ currentArgs: args, element });
                }
                catch (error) {
                    consoleLog(`Error in scopeValues function: ${error}`);
                }
            }
            if (typeof element.scopeValue === "string") {
                scopeValue = element.scopeValue;
            }
            if (typeof scopeValues === "object") {
                return setScopesInternal({ ...scopeValues },
                    context.active(),
                    () => {
                        return original.apply(this, args);
                    }
                )
            }
            else if (typeof scopeName === "string") {
                return setScopesInternal({ [scopeName]: scopeValue },
                    context.active(),
                    () => {
                        return original.apply(this, args);
                    }
                )
            }
            // If no scope name is provided, just call the original function
            return original.apply(this, args);
        };
    };
}

function processMultipleElementsWithTracing(
    thisArg: () => any,
    elements: WrapperArguments[],
    spanHandler: SpanHandler,
    original: Function,
    args: any,
    sourcePathValue: string
) {
    // Process elements recursively, creating nested spans
    return processElementsRecursively(thisArg, elements, 0, spanHandler, original, args, sourcePathValue);
}

function processElementsRecursively(
    thisArg: () => any,
    elements: WrapperArguments[],
    index: number,
    spanHandler: SpanHandler,
    original: Function,
    args: any,
    sourcePath: string
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
            return processElementsRecursively(thisArg, elements, index + 1, spanHandler, original, args, sourcePath);
        },
        args,
        sourcePath
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

    let ex = null;
    let parentSpan: Span = trace.getActiveSpan() as Span;
    const ret_val = tracer.startActiveSpan(
        getSpanName(element),
        (span: Span) => {
            const endSpan = () => {
                span.end();
            };
            if (isRootSpan(span) || shouldAddWorkflowSpan) {
                spanHandler.setWorkflowProperties({ span, instance: thisArg, args: args, element });
                returnValue = handleSpanProcess({ currentContext, tracer, element, spanHandler, thisArg, args, original, shouldAddWorkflowSpan: false, sourcePath });
                span.updateName("workflow");
                if (typeof returnValue === 'object' && returnValue !== null && typeof returnValue.then === "function") {
                    // Return the promise chain to ensure proper propagation
                    returnValue = returnValue.then((result: any) => {
                        endSpan();
                        return result;
                    }).catch((error: any) => {
                        endSpan();
                        throw error;
                    });
                }
                else {
                    endSpan();
                }
            }
            else {
                try {
                    returnValue = original.apply(thisArg, args);
                }
                catch (error) {
                    ex = error;
                    // span.setStatus({ code: 2, message: error?.message || "Error occurred" });
                    consoleLog(`Error in span processing: ${error}`);
                    throw error;
                }
                finally {
                    if (typeof returnValue === 'object' && returnValue !== null && typeof returnValue.then === "function") {
                        // Return the promise chain to ensure proper propagation
                        returnValue = returnValue.then((result: any) => {
                            postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue: result, element, args: args, sourcePath, exception: ex, parentSpan });
                            return result;
                        }).catch((error: any) => {
                            span.setStatus({ code: 2, message: error?.message || "Error occurred" });
                            postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue: error, element, args: args, sourcePath, exception: error || ex, parentSpan });
                            if (span.isRecording()) {
                                span.end()
                            }

                            throw error;
                        });
                    }
                    else {
                        postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue, element, args: args, sourcePath, exception: ex, parentSpan });
                    }
                }
            }

            spanHandler.setDefaultMonocleAttributes({ span: span, instance: thisArg, args: args, element: element, sourcePath: sourcePath });

            return returnValue;
        }
    );

    return ret_val;
}

function getSpanName(element: WrapperArguments): string {
    return element.spanName || (element.package || '' + element.object || '' + element.method || '');
}

function postProcessSpanData({ instance, spanHandler, span, returnValue, element, args, sourcePath, exception, parentSpan }: { instance: () => any, spanHandler: SpanHandler, span: Span, returnValue: any, element: WrapperArguments, args: any, sourcePath: string, exception: any, parentSpan: Span | null }) {

    // if to_wrap.get("output_processor") and to_wrap.get("output_processor").get("response_processor"):
    // # Process the stream
    // to_wrap.get("output_processor").get("response_processor")(to_wrap, return_value, post_process_span_internal)
    const spanProcessor = ({ finalReturnValue }) => {
        spanHandler.postProcessSpan({ span, instance: instance, args: args, returnValue, outputProcessor: null, sourcePath: sourcePath, exception: exception });
        spanHandler.processSpan({ span, instance: instance, args: args, outputProcessor: element.output_processor, returnValue: finalReturnValue, wrappedPackage: element.package, exception, parentSpan });
        span.end();
    }
    if (element.output_processor && typeof element.output_processor[0].response_processor === "function" && !exception) {
        element.output_processor[0].response_processor({ element, returnValue, spanProcessor });
    }
    else {
        spanProcessor({ finalReturnValue: returnValue });
    }

}

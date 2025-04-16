import { context, Tracer } from "@opentelemetry/api";
import { setScopesInternal } from "./utils";
import { attachWorkflowType, DefaultSpanHandler, isRootSpan, SpanHandler } from "./spanHandler";
import { ADD_NEW_WORKFLOW_SYMBOL, WrapperArguments } from "./constants";
import { consoleLog } from "../../common/logging";

export const getPatchedMain = function (element: WrapperArguments) {
    const spanHandler: SpanHandler = element.spanHandler || new DefaultSpanHandler();
    return function mainMethodName(original: Function) {
        return function patchMainMethodName() {
            return processSpanWithTracing(this, element, spanHandler, original, arguments);
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
    args: any
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
        args
    );
}

function processSpanWithTracing(
    thisArg: () => any,
    element: WrapperArguments,
    spanHandler: SpanHandler,
    original: Function,
    args: any
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
            return handleSpanProcess({ currentContext, tracer, element, spanHandler, thisArg, args, original, shouldAddWorkflowSpan });
        });
    }

}

function handleSpanProcess({ currentContext, tracer, element, spanHandler, thisArg, args, original, shouldAddWorkflowSpan }: { currentContext: any, tracer: Tracer, element: WrapperArguments, spanHandler: SpanHandler, thisArg: () => any, args: any, original: Function, shouldAddWorkflowSpan: boolean }) {
    let returnValue: any;


    return tracer.startActiveSpan(
        getSpanName(element),
        (span) => {
            spanHandler.setDefaultMonocleAttributes({ span: span, instance: thisArg, args: args, element: element });
            if (isRootSpan(span) || shouldAddWorkflowSpan) {
                spanHandler.setWorkflowProperties({ span, instance: thisArg, args: args, element });
                returnValue = handleSpanProcess({ currentContext, tracer, element, spanHandler, thisArg, args, original, shouldAddWorkflowSpan: false });
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
                        postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue: result, element, args: args });
                    }).catch((error: any) => {
                        span.setStatus({ code: 2, message: error?.message || "Error occurred" });
                        postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue: error, element, args: args });
                    });
                }
                else {
                    postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue, element, args: args });
                }
            }

            return returnValue;
        }
    );
}

function getSpanName(element: WrapperArguments): string {
    return element.spanName || (element.package || '' + element.object || '' + element.method || '');
}

function postProcessSpanData({ instance, spanHandler, span, returnValue, element, args }) {
    spanHandler.postProcessSpan({ span, instance: instance, args: args, returnValue, outputProcessor: null });
    spanHandler.processSpan({ span, instance: instance, args: args, outputProcessor: element.output_processor, returnValue, wrappedPackage: element.package });
    span.end();
}

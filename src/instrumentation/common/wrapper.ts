import { context, Tracer } from "@opentelemetry/api";
import { setScopesInternal } from "./utils";
import { attachWorkflowType, DefaultSpanHandler, isNonWorkflowRootSpan, SpanHandler } from "./spanHandler";
import { WrapperArguments } from "./constants";
import { consoleLog } from "../../common/logging";

export const getPatchedMain = function (element: WrapperArguments) {
    const spanHandler: SpanHandler = element.spanHandler || new DefaultSpanHandler();
    return function mainMethodName(original: Function) {
        return function patchMainMethodName() {
            return processSpanWithTracing(this, element, spanHandler, original, arguments)
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

function processSpanWithTracing(
    thisArg: () => any,
    element: WrapperArguments,
    spanHandler: SpanHandler,
    original: Function,
    args: any,
    recursive = false
) {
    const tracer = element.tracer;
    const skipSpan = element.skipSpan || spanHandler.skipSpan({ instance: thisArg, args: args, element });
    let currentContext = context.active();
    if (!element.skipSpan) {
        currentContext = attachWorkflowType(element)
    }
    if (skipSpan) {
        spanHandler.preTracing(element);
        return original.apply(thisArg, args);
    }
    let returnValue: any;

    return context.with(currentContext, () => {
        return tracer.startActiveSpan(
            getSpanName(element),
            (span) => {
                spanHandler.preProcessSpan({ span: span, instance: this, args: args, element: element });
                if (isNonWorkflowRootSpan(span, element) && !recursive) {
                    processSpanWithTracing(thisArg, element, spanHandler, original, args, true);
                    returnValue = original.apply(thisArg, args);
                    span.updateName("workflow." + getSpanName(element));
                    span.end();
                }
                else {
                    returnValue = original.apply(thisArg, args);
                    if (typeof returnValue === 'object' && returnValue !== null && typeof returnValue.then === "function") {
                        returnValue.then((result: any) => {
                            postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue: result, element, args: args });
                        });
                    }
                    else {
                        postProcessSpanData({ instance: thisArg, spanHandler, span, returnValue, element, args: args });
                    }
                }

                return returnValue;
            }
        );
    });
}

function getSpanName(element: WrapperArguments): string {
    return element.spanName || (element.package || '' + element.object || '' + element.method || '');
}

function postProcessSpanData({ instance, spanHandler, span, returnValue, element, args }) {
    spanHandler.postProcessSpan({ span, instance: instance, args: args, returnValue, outputProcessor: null });
    spanHandler.processSpan({ span, instance: instance, args: args, outputProcessor: element.output_processor, returnValue, wrappedPackage: element.package });
    span.end();
}

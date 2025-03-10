import { context, Tracer } from "@opentelemetry/api";
import { setScopesInternal } from "./utils";
import { DefaultSpanHandler, SpanHandler } from "./spanHandler";
import { WrapperArguments } from "./constants";

export const getPatchedMain = function (element : WrapperArguments) {
    const spanHandler: SpanHandler = element.spanHandler || new DefaultSpanHandler();
    const tracer = element.tracer;
    return function mainMethodName(original: Function) {
        return function patchMainMethodName() {
            if (element.skipSpan) {
                spanHandler.preTracing(element);
                if(spanHandler.executeFunction) {
                    return spanHandler.executeFunction(element, () => original.apply(this, arguments));
                }
                return original.apply(this, arguments);
            }
            return tracer.startActiveSpan(
                element.spanName || element.package || '' + element.object || '' + element.method || '',
                (span) => {
                    spanHandler.preProcessSpan({ span: span, instance: this, args: arguments, outputProcessor: null });
                    const returnValue = original.apply(this, arguments);
                    spanHandler.postProcessSpan({ span, instance: this, args: arguments, returnValue, outputProcessor: null });
                    spanHandler.processSpan({ span, instance: this, args: arguments, outputProcessor: element.output_processor, returnValue, wrappedPackage: element.package });
                    span.end();
                    return returnValue;
                }
            );
        };
    };
}

export const getPatchedScopeMain = function ({ tracer, ...element }: { tracer: Tracer, spanName: string, package: string, object: string, method: string, output_processor: any, scopeName: string }) {
    return function mainMethodName(original: Function) {
        return function patchMainMethodName() {
            return setScopesInternal({ [element.scopeName]: null },
                context.active(),
                () => {
                    return original.apply(this, arguments);
                }
            )
        };
    };
}
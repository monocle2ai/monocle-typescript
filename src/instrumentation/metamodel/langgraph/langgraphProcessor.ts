import {
    AGENT_PREFIX_KEY, DELEGATION_NAME_PREFIX, LANGGRAPH_AGENT_NAME_KEY, WrapperArguments,
} from "../../common/constants";
import { setScopesBind } from "../../common/instrumentation";
import { Span } from "../../common/opentelemetryUtils";
import { isRootSpan, DefaultSpanHandler } from "../../common/spanHandler";
import { AGENT_DELEGATION, AGENT_REQUEST } from "./entities/inference";

function getName(instance: any): string {
    return instance?.name ||
        instance?.constructor?.name ||
        instance?.lc_runnable?.name ||
        "langgraph_agent";
}

const ROOT_AGENT_NAME = 'LangGraph'


export class LangGraphAgentSpanHandler extends DefaultSpanHandler {

    preTracing(_: WrapperArguments, currentContext: any, thisArg?: any): any {
        currentContext = currentContext.setValue(LANGGRAPH_AGENT_NAME_KEY, getName(thisArg));
        currentContext = currentContext.setValue(AGENT_PREFIX_KEY, DELEGATION_NAME_PREFIX);
        const scopeName = AGENT_REQUEST["type"];
        if (scopeName && thisArg.name === ROOT_AGENT_NAME && !currentContext.getValue(scopeName)) {
            return setScopesBind({ [scopeName]: null }, currentContext);
        }
        return currentContext;
    }


    processSpan({ span, instance, args, returnValue, outputProcessor, wrappedPackage, exception, parentSpan }: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
        wrappedPackage: string;
        exception?: any;
        parentSpan?: Span;
    }) {
        // For CompiledStateGraph with parent agent span, use AGENT_REQUEST processor
        if (getName(instance) === "CompiledStateGraph" && span.attributes["parent.agent.span"]) {
            const agentRequestProcessor = [AGENT_REQUEST]
            super.processSpan({
                span,
                instance,
                args,
                returnValue,
                outputProcessor: agentRequestProcessor,
                wrappedPackage: wrappedPackage,
                exception,
                parentSpan,
            });
        }
        // For agents with names and parent spans, use the configured processor
        else if (instance.name && parentSpan && !isRootSpan(span)) {
            parentSpan.setAttribute("parent.agent.span", true);
            super.processSpan({
                span,
                instance,
                args,
                returnValue,
                outputProcessor,
                wrappedPackage: wrappedPackage,
                exception,
                parentSpan,
            });
        }
        // For all other LangGraph agent invocations, use the configured processor
        else {
            super.processSpan({
                span,
                instance,
                args,
                returnValue,
                outputProcessor,
                wrappedPackage: wrappedPackage,
                exception,
                parentSpan,
            });
        }
    }
}



export class LangGraphToolSpanHandler extends DefaultSpanHandler {

    processSpan({ span, instance, args, returnValue, outputProcessor, wrappedPackage, exception, parentSpan }: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
        wrappedPackage: string;
        exception?: any;
        parentSpan?: Span;
    }) {
        if (getName(instance).startsWith(DELEGATION_NAME_PREFIX.description)) {
            const agentRequestProcessor = [AGENT_DELEGATION]
            super.processSpan({
                span,
                instance,
                args,
                returnValue,
                outputProcessor: agentRequestProcessor,
                wrappedPackage: wrappedPackage,
                exception,
                parentSpan,
            });
        } else {
            // For all other tool invocations, use the configured processor
            super.processSpan({
                span,
                instance,
                args,
                returnValue,
                outputProcessor,
                wrappedPackage: wrappedPackage,
                exception,
                parentSpan,
            });
        }
    }
}
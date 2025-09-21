import {
    AGENT_PREFIX_KEY, DELEGATION_NAME_PREFIX, WrapperArguments,
} from "../../common/constants";
import { Span } from "../../common/opentelemetryUtils";
import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { consoleLog } from "../../../common/logging";
import { AGENTS_AGENT_NAME_KEY_SYMBOL } from "./entities/inference";
import { Tracer } from "@opentelemetry/api";
import { getPatchedMain } from "../../common/wrapper";


function getAgentName(instance: any): string {
    return instance?.name ||
        instance?.constructor?.name ||
        instance?.lc_runnable?.name ||
        instance?.agent?.name ||
        "openai_agent";
}

export class AgentsSpanHandler extends NonFrameworkSpanHandler {
    preTracing(_element: WrapperArguments, currentContext: any, thisArg?: any): any {
        try {
            const agentName = getAgentName(thisArg);
            currentContext = currentContext.setValue(AGENTS_AGENT_NAME_KEY_SYMBOL, agentName);
            currentContext = currentContext.setValue(AGENT_PREFIX_KEY, DELEGATION_NAME_PREFIX);
        } catch (error) {
            consoleLog('Warning: Error setting agent context:', error);
        }

        return currentContext;
    }

    postProcessSpan({ span, instance, args, returnValue, outputProcessor, exception, currentContext }: {
        span: Span;
        instance: any;
        args: IArguments;
        returnValue: any;
        outputProcessor: any;
        exception?: any;
        currentContext?: any;
    }) {

        currentContext = currentContext.setValue(AGENT_PREFIX_KEY, null);
        super.postProcessSpan({ span, instance, args, returnValue, outputProcessor, exception, currentContext });
    }
}

export function toolConstructorWrapper(
    tracer: Tracer,
    _handler: NonFrameworkSpanHandler,
    element: any,
    wrapped: Function,
    instance: any,
    _sourcePath: string,
    args: any[],
) {
    const config = args[0] || {};

    const originalFunc = config.execute;

    const toolInstance = {
        name: config.name || 'unknown_tool',
        description: config.description || 'No description provided',
    };

    // Check if already wrapped - check the config.execute directly
    if (originalFunc && !(config.execute as any)._monocleWrapped) {
        // Create the instrumentation element for the tool execution
        const toolElement = {
            tracer,
            package: element.package || 'openai_agents',
            object: element.object || 'tool',
            method: toolInstance.name || 'execute',
            spanName: `openai.tool.execute`,
            output_processor: element.output_processor || []
        };

        // Use getPatchedMain to create the wrapper
        const patchedMainWrapper = getPatchedMain(toolElement);
        const wrappedFunc = patchedMainWrapper(originalFunc);

        // Replace the original function with the wrapped one
        config.execute = wrappedFunc;
        config.invoke = wrappedFunc;
        config._invoke = wrappedFunc;

        // Preserve function metadata
        (wrappedFunc as any).__name = wrapped.name || 'unknown_tool';
        (wrappedFunc as any).__doc = (wrapped as any).__doc || '';

        // Mark function as wrapped - mark both the wrapper and the config property
        (wrappedFunc as any)._monocleWrapped = true;
        (config.execute as any)._monocleWrapped = true;
    }

    // Call the original function and return its result
    const result = wrapped.apply(instance, args);
    return result;
}

export function handoffConstructorWrapper(
    tracer: Tracer,
    _handler: NonFrameworkSpanHandler,
    element: any,
    wrapped: Function,
    instance: any,
    _sourcePath: string,
    args: any[],
) {
    // Get the handoff arguments: agent and optional config
    const agent = args[0];
    const config = args[1] || {};

    // Check for onHandoff callback in config
    const originalHandoffFunc = config.onHandoff;

    // Create handoff instance for metadata  
    const handoffInstance = {
        name: agent?.name || config.toolNameOverride || 'unknown_handoff',
        description: config.toolDescriptionOverride || 'Agent handoff',
    };

    if (originalHandoffFunc && !(originalHandoffFunc as any)._monocleWrapped) {
        // Create the instrumentation element for the handoff execution
        const handoffElement = {
            tracer,
            package: element.package || 'openai_agents',
            object: element.object || 'handoff',
            method: handoffInstance.name || 'execute',
            spanName: `openai.handoff.execute`,
            output_processor: element.output_processor || []
        };

        // Use getPatchedMain to create the wrapper
        const patchedMainWrapper = getPatchedMain(handoffElement);
        const wrappedFunc = patchedMainWrapper(originalHandoffFunc);

        // Replace the original function with the wrapped one
        config.onHandoff = wrappedFunc;

        // Preserve function metadata
        (wrappedFunc as any).__name = wrapped.name || 'unknown_handoff';
        (wrappedFunc as any).__doc = (wrapped as any).__doc || '';

        // Mark function as wrapped
        (wrappedFunc as any)._monocleWrapped = true;
        (config.onHandoff as any)._monocleWrapped = true;
    }

    // Call the original function and return its result
    const result = wrapped.apply(instance, args);
    return result;
}
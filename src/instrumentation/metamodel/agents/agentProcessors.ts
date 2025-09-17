import {
    AGENT_PREFIX_KEY, DELEGATION_NAME_PREFIX, WrapperArguments,
} from "../../common/constants";
import { Span } from "../../common/opentelemetryUtils";
import { NonFrameworkSpanHandler } from "../../common/spanHandler";
import { consoleLog } from "../../../common/logging";
import { AGENTS_AGENT_NAME_KEY_SYMBOL } from "./entities/inference";


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
import { ADK_AGENT_NAME_KEY, WrapperArguments } from "../../common/constants";
import { DefaultSpanHandler } from "../../common/spanHandler";

function getAgentName(thisArg: any): string {
    return thisArg?.name || thisArg?.agent?.name || thisArg?.constructor?.name || "adk_agent";
}

export class ADKAgentSpanHandler extends DefaultSpanHandler {
    preTracing(_: WrapperArguments, currentContext: any, thisArg?: any): any {
        return currentContext.setValue(ADK_AGENT_NAME_KEY, getAgentName(thisArg));
    }
}

export class ADKToolSpanHandler extends DefaultSpanHandler {}

export class ADKRunnerSpanHandler extends DefaultSpanHandler {
    preTracing(_: WrapperArguments, currentContext: any, thisArg?: any): any {
        const rootAgentName = thisArg?.agent?.name || thisArg?.appName || "adk_runner";
        return currentContext.setValue(ADK_AGENT_NAME_KEY, rootAgentName);
    }
}

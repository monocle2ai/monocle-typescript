import { Tracer } from "@opentelemetry/api";
import { SpanHandler } from "./spanHandler";

const AWS_CONSTANTS = {
    AWS_LAMBDA_FUNCTION_NAME: 'AWS_LAMBDA_FUNCTION_NAME',
}

const _AWS_CONSTANTS = AWS_CONSTANTS
export { _AWS_CONSTANTS as AWS_CONSTANTS }

export const MONOCLE_SCOPE_NAME_PREFIX = 'monocle.scope.';

// Constants
export const SCOPE_METHOD_FILE = process.env.SCOPE_METHOD_FILE || 'monocle_scopes.json';
export const SCOPE_CONFIG_PATH = process.env.SCOPE_CONFIG_PATH

export interface WrapperArguments {
    tracer: Tracer, 
    spanName: string, 
    package: string, 
    object: string, 
    method: string, 
    output_processor: any,
    spanHandler?: SpanHandler,
    skipSpan?: boolean,
    scopeName?: string,
    spanType?: string,
}
const WORKFLOW_TYPE_KEY = "monocle.workflow_type"
export const WORKFLOW_TYPE_KEY_SYMBOL = Symbol(WORKFLOW_TYPE_KEY)
export const WORKFLOW_TYPE_GENERIC = "workflow.generic"
export const MONOCLE_SDK_VERSION = "monocle_apptrace.version"
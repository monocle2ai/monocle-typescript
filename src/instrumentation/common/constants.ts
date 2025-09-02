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



export interface MethodConfig {
  package: string;
  object: string;
  method: string;
  spanName?: string;
  spanType?: string;
  output_processor?: any[];
  scopeName?: string;
  scopeValue?: string | ((...args: any[]) => string);
  scopeValues?: Record<string, string> | (( {currentArgs, element}: {currentArgs: any[], element: MethodConfig}) => Record<string, string>);
  skipSpan?: boolean;
}
export interface WrapperArguments extends MethodConfig {
    tracer: Tracer, 
    spanHandler?: SpanHandler,
    instance?: any,
    currentContext?: any
}


const WORKFLOW_TYPE_KEY = "monocle.workflow_type"
export const WORKFLOW_TYPE_KEY_SYMBOL = Symbol(WORKFLOW_TYPE_KEY)
export const ADD_NEW_WORKFLOW_STRING = "monocle.add_new_workflow"
export const ADD_NEW_WORKFLOW_SYMBOL = Symbol(ADD_NEW_WORKFLOW_STRING);
export const MONOCLE_SDK_LANGUAGE = "monocle_apptrace.language"
export const WORKFLOW_TYPE_GENERIC = "workflow.generic"
export const MONOCLE_SDK_VERSION = "monocle_apptrace.version"
export const MONOCLE_DETECTED_SPAN_ERROR = "monocle_apptrace.detected_span_error"

// # Azure environment constants
const AZURE_ML_ENDPOINT_ENV_NAME = "AZUREML_ENTRY_SCRIPT"
const AZURE_FUNCTION_WORKER_ENV_NAME = "FUNCTIONS_WORKER_RUNTIME"
const AZURE_APP_SERVICE_ENV_NAME = "WEBSITE_SITE_NAME"
const AWS_LAMBDA_ENV_NAME = "AWS_LAMBDA_RUNTIME_API"
const GITHUB_CODESPACE_ENV_NAME = "CODESPACES"
const VERCEL_ENV_NAME = "VERCEL_URL"

const AWS_LAMBDA_FUNCTION_IDENTIFIER_ENV_NAME = "AWS_LAMBDA_FUNCTION_NAME"
const AZURE_FUNCTION_IDENTIFIER_ENV_NAME = "WEBSITE_SITE_NAME"
const AZURE_APP_SERVICE_IDENTIFIER_ENV_NAME = "WEBSITE_DEPLOYMENT_ID"
const GITHUB_CODESPACE_IDENTIFIER_ENV_NAME = "GITHUB_REPOSITORY"


// # Azure naming reference can be found here
// # https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations
const AZURE_FUNCTION_NAME = "azure.func"
const AZURE_APP_SERVICE_NAME = "azure.asp"
const AZURE_ML_SERVICE_NAME = "azure.mlw"
const AWS_LAMBDA_SERVICE_NAME = "aws.lambda"
const GITHUB_CODESPACE_SERVICE_NAME = "github_codespace"
const VERCEL_SERVICE_NAME = "vercel"

// # Env variables to identify infra service type
export const service_type_map = {
    [AZURE_ML_ENDPOINT_ENV_NAME]: AZURE_ML_SERVICE_NAME,
    [AZURE_APP_SERVICE_ENV_NAME]: AZURE_APP_SERVICE_NAME,
    [AZURE_FUNCTION_WORKER_ENV_NAME]: AZURE_FUNCTION_NAME,
    [AWS_LAMBDA_ENV_NAME]: AWS_LAMBDA_SERVICE_NAME,
    [GITHUB_CODESPACE_ENV_NAME]: GITHUB_CODESPACE_SERVICE_NAME,
    [VERCEL_ENV_NAME]: VERCEL_SERVICE_NAME,
}

// # Env variables to identify infra service name
export const service_name_map = {
    [AZURE_APP_SERVICE_NAME]: AZURE_APP_SERVICE_IDENTIFIER_ENV_NAME,
    [AZURE_FUNCTION_NAME]: AZURE_FUNCTION_IDENTIFIER_ENV_NAME,
    [AZURE_ML_SERVICE_NAME]: AZURE_ML_ENDPOINT_ENV_NAME,
    [AWS_LAMBDA_SERVICE_NAME]: AWS_LAMBDA_FUNCTION_IDENTIFIER_ENV_NAME,
    [GITHUB_CODESPACE_SERVICE_NAME]: GITHUB_CODESPACE_IDENTIFIER_ENV_NAME,
    [VERCEL_SERVICE_NAME]: VERCEL_ENV_NAME,
}

export const LANGGRAPH_AGENT_NAME_KEY = Symbol("agent.langgraph");
export const AGENT_PREFIX_KEY = Symbol("monocle.agent.prefix")
export const DELEGATION_NAME_PREFIX = Symbol("transfer_to_")
export const INFERENCE_AGENT_DELEGATION = "delegation"
export const INFERENCE_TOOL_CALL = "tool_call"
export const INFERENCE_COMMUNICATION = "turn"

export const SPAN_TYPES = {
    GENERIC: "generic",
    AGENTIC_DELEGATION: "agentic.delegation",
    AGENTIC_TOOL_INVOCATION: "agentic.tool.invocation",
    AGENTIC_INVOCATION: "agentic.invocation",
    AGENTIC_MCP_INVOCATION: "agentic.mcp.invocation",
    AGENTIC_REQUEST: "agentic.request",

    HTTP_PROCESS: "http.process",
    HTTP_SEND: "http.send",

    RETRIEVAL: "retrieval",
    INFERENCE: "inference",
    INFERENCE_FRAMEWORK: "inference.framework"
} as const;

export type SpanType = typeof SPAN_TYPES[keyof typeof SPAN_TYPES];

export const SPAN_SUBTYPE_PLANNING = "planning";
export const SPAN_SUBTYPE_ROUTING = "routing";
export const SPAN_SUBTYPE_CONTENT_PROCESSING = "content_processing";
export const SPAN_SUBTYPE_CONTENT_GENERATION = "content_generation";
export const SPAN_SUBTYPE_COMMUNICATION = "communication";
export const SPAN_SUBTYPE_TRANSFORMATIONS = "transformations";
export const SPAN_SUBTYPE_DOMAIN_SPECIFIC = "domain_specific";
export const SPAN_SUBTYPE_GENERIC = "generic";


export const AGENT_REQUEST_SPAN_NAME = "agentic.request"

export const SPAN_SUBTYPES = {
    PLANNING: SPAN_SUBTYPE_PLANNING,
    ROUTING: SPAN_SUBTYPE_ROUTING,
    CONTENT_PROCESSING: SPAN_SUBTYPE_CONTENT_PROCESSING,
    CONTENT_GENERATION: SPAN_SUBTYPE_CONTENT_GENERATION,
    COMMUNICATION: SPAN_SUBTYPE_COMMUNICATION,
    TRANSFORMATIONS: SPAN_SUBTYPE_TRANSFORMATIONS,
    DOMAIN_SPECIFIC: SPAN_SUBTYPE_DOMAIN_SPECIFIC,
    GENERIC: SPAN_SUBTYPE_GENERIC
} as const;

export type SpanSubtype = typeof SPAN_SUBTYPES[keyof typeof SPAN_SUBTYPES];
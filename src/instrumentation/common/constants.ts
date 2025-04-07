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
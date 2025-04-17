import * as path from 'path';
import * as fs from 'fs'
import { context as context_api, propagation, Context, Tracer } from "@opentelemetry/api";
import { RandomIdGenerator } from "@opentelemetry/sdk-trace-node";
import { MONOCLE_SCOPE_NAME_PREFIX, SCOPE_CONFIG_PATH, SCOPE_METHOD_FILE } from "./constants";
import { consoleLog } from "../../common/logging";
import { DefaultSpanHandler, attachWorkflowType } from './spanHandler';

let _instrumentor = null
export function setInstrumentor(instrumentor: any) {
    _instrumentor = instrumentor;
}

const scope_id_generator = new RandomIdGenerator();

const http_scopes: Record<string, string> = {};

export const get_http_scopes = () => {
    return http_scopes;
}

function _generateScopeId(): string {
    return `${scope_id_generator.generateTraceId()}`;
}

export function setScopesInternal<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    scopes: Record<string, string | null>,
    baggage_context: Context | null = null,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
) {
    let updated_baggage_context = updateBaggageContextWithScopes(baggage_context, scopes);
    return context_api.with(updated_baggage_context, fn, thisArg, ...args);
}

function updateBaggageContextWithScopes(baggage_context: Context, scopes: Record<string, string>) {
    if (baggage_context === null) {
        baggage_context = context_api.active();
    }
    let baggage = propagation.getBaggage(baggage_context) || propagation.createBaggage();

    for (const [scope_name, scope_value] of Object.entries(scopes)) {
        const finalValue = typeof scope_value === "string" ? scope_value : _generateScopeId();
        baggage = baggage.setEntry(
            `${MONOCLE_SCOPE_NAME_PREFIX}${scope_name}`,
            {
                value: finalValue
            }
        );
    }
    const updated_baggage_context = propagation.setBaggage(baggage_context, baggage);
    return updated_baggage_context;
}

export function setScopesBindInternal(
    scopes: Record<string, string | null>,
    baggage_context: Context | null = null,
    fn: Function
): Function {
    let updated_baggage_context = updateBaggageContextWithScopes(baggage_context, scopes);
    return context_api.bind(updated_baggage_context, fn);
}

// export function remove_scope(token: object): void {
//     remove_scopes(token);
// }

// function remove_scopes(token: object | null): void {
//     if (token !== null) {
//         context.detach(token);
//     }
// }

export function getScopesInternal(): Record<string, string> {
    const monocle_scopes: Record<string, string> = {};
    const currentBaggage = propagation.getActiveBaggage();
    if (!currentBaggage) {
        return monocle_scopes;
    }

    for (const [key, val] of currentBaggage.getAllEntries()) {
        if (key.startsWith(MONOCLE_SCOPE_NAME_PREFIX)) {
            monocle_scopes[key.substring(MONOCLE_SCOPE_NAME_PREFIX.length)] = val.value;
        }
    }

    return monocle_scopes;
}

export function getBaggageForScopes(): Context | null {
    let currentContext = context_api.active()
    let baggage = propagation.getBaggage(currentContext);
    for (const [scope_key, scope_value] of Object.entries(getScopesInternal())) {
        const monocle_scope_name = `${MONOCLE_SCOPE_NAME_PREFIX}${scope_key}`;
        baggage.setEntry(monocle_scope_name, { value: scope_value });
    }
    propagation.setBaggage(currentContext, baggage);
    return currentContext;
}

export function load_scopes(): any[] {
    let methods_data: any[] = [];
    let scope_methods: any[] = [];
    if (!SCOPE_CONFIG_PATH) {
        consoleLog('SCOPE_CONFIG_PATH not set');
        return scope_methods;
    }
    try {
        const methodsJson = fs.readFileSync(
            path.join(SCOPE_CONFIG_PATH || '', SCOPE_METHOD_FILE),
            'utf8'
        );
        methods_data = JSON.parse(methodsJson);
        for (const method of methods_data) {
            if (method.http_header) {
                http_scopes[method.http_header] = method.scope_name;
            } else {
                scope_methods.push(method);
            }
        }
    } catch (e) {
        consoleLog(`Error loading scope methods from file: ${e}`);
    }
    return scope_methods;
}

export function startTraceInternal<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
) {
    let isFnCalled = false;
    try {
        const tracer: Tracer = _instrumentor.getTracer();
        const contextWithWorkflow = attachWorkflowType();
        return context_api.with(contextWithWorkflow, () => {
            return tracer.startActiveSpan("workflow", (span) => {
                DefaultSpanHandler.setMonocleAttributes(span);
                DefaultSpanHandler.setWorkflowAttributes({ span, wrappedPackage: null });
                // Mark that we're about to call the function
                isFnCalled = true;
                // If fn throws, this error will propagate out of startActiveSpan
                const returnValue = fn.apply(thisArg, args);
                if(typeof returnValue === 'object' && returnValue !== null && typeof returnValue.then === "function") {
                    returnValue.finally(() => {
                        span.end();
                    })
                }
                else{
                    span.end();
                }
                
                return returnValue
            });
        })
    }
    catch (e) {
        // This catches errors from both tracer setup and from fn itself
        consoleLog(`Failed to start trace: ${e}`);
        // No return here - will fall through to finally block
    }
    finally {
        // Only call fn if it hasn't been called already (tracer setup failed)
        if (!isFnCalled) {
            consoleLog("Failed to start trace");
            return fn.apply(thisArg, args);
        }
        // If fn was already called (but threw an error), we don't call it again
    }
}


// export function set_scopes_from_baggage(baggage_context: Context): void {
//     const baggageEntries = propagation.getBaggage(baggage_context).getAllEntries();
//     for (const [scope_key, scope_value] of baggageEntries) {
//         if (scope_key.startsWith(MONOCLE_SCOPE_NAME_PREFIX)) {
//             const scope_name = scope_key.substring(MONOCLE_SCOPE_NAME_PREFIX.length);
//             set_scope(scope_name, scope_value.value);
//         }
//     }
// }

export function isVercelEnvironment(): boolean {
    return !!process.env.VERCEL_URL
}

export function isAwsLambdaEnvironment(): boolean {
    return !!process.env.AWS_LAMBDA_RUNTIME_API && !isVercelEnvironment()
}
export function extractInferenceEndpoint(instance: any): string | undefined {
    try {
        if (instance?.client) {
            if (instance.client._client?.base_url) {
                return instance.client._client.base_url.toString();
            }
            if (instance.client.meta?.endpoint_url) {
                return instance.client.meta.endpoint_url.toString();
            }
        }
        
        if (instance?._client?.base_url) {
            return instance._client.base_url.toString();
        }
        
        if (instance?._client?.baseURL) {
            return instance._client.baseURL.toString();
        }

        return undefined;
    } catch (e) {
        console.warn("Error extracting inference endpoint:", e);
        return undefined;
    }
}

export function detectSdkType(instance: any): string {
    try {
        const endpoint = extractInferenceEndpoint(instance);
        
        if (endpoint?.includes('anthropic.com')) {
            return 'inference.anthropic';
        }
        if (endpoint?.includes('openai.com')) {
            return 'inference.openai';
        }
        if (endpoint?.includes('cohere.ai')) {
            return 'inference.cohere';
        }
        
        const constructorName = instance?.constructor?.name || 
                              instance?._client?.constructor?.name;
        
        if (constructorName) {
            if (constructorName.includes('Anthropic')) return 'inference.anthropic';
            if (constructorName.includes('OpenAI')) return 'inference.openai';
            if (constructorName.includes('Cohere')) return 'inference.cohere';
        }

        return 'inference.unknown';
    } catch (e) {
        console.warn("Error detecting SDK type:", e);
        return 'inference.unknown';
    }
}
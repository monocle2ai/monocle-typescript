import { registerModule } from "./esmModule"

import {
    InstrumentationBase,
    InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import { context } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider, SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { combinedPackages } from "./packages";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { getPatchedMain, getPatchedScopeMain, getPatchedMainList } from "./wrapper";
import { AWS_CONSTANTS } from './constants';
import * as path from 'path';
import { Hook as ImportHook } from "import-in-the-middle";
import { Hook as RequireHook } from "require-in-the-middle";
import { getMonocleExporters } from '../../exporters';
import { PatchedBatchSpanProcessor } from './opentelemetryUtils';
import { AWSS3SpanExporter } from '../../exporters/aws/AWSS3SpanExporter'
import { consoleLog } from '../../common/logging';
import { setScopesInternal, getScopesInternal, setScopesBindInternal, load_scopes, setInstrumentor, startTraceInternal } from './utils';

class MonocleInstrumentation extends InstrumentationBase {
    constructor(config = {}) {
        super('MonocleInstrumentation', "1.0", config)
        consoleLog('MonocleInstrumentation initialized with config:', config);
    }

    public getTracer() {
        return this.tracer;
    }

    /**
     * Init method will be called when the plugin is constructed.
     * It returns an `InstrumentationNodeModuleDefinition` which describes
     *   the node module to be instrumented and patched.
     * It may also return a list of `InstrumentationNodeModuleDefinition`s if
     *   the plugin should patch multiple modules or versions.
     */
    init() {
        consoleLog('Initializing MonocleInstrumentation');
        const modules: any[] = []
        const scopeMethodsForInstrumentation = load_scopes();

        // @ts-ignore: custom field access
        let packagesForInstrumentation = combinedPackages.concat(this._config.userWrapperMethods || [])
        packagesForInstrumentation = packagesForInstrumentation.concat(scopeMethodsForInstrumentation)

        // Group packages by package name
        const groupedPackages = this._groupPackagesByName(packagesForInstrumentation);

        // Create module definitions for each group
        for (const [_, elements] of Object.entries(groupedPackages)) {
            const module = new InstrumentationNodeModuleDefinition(
                elements[0].package,
                ['*'],
                this._getOnPatchMain(elements).bind(this),
            );
            modules.push(module);
        }

        consoleLog(`Initialized ${modules.length} modules for instrumentation`);
        return modules;
    }

    enable() {
        consoleLog('Enabling MonocleInstrumentation');
        // @ts-ignore: private field access required
        if (this._enabled) {
            return;
        }
        // @ts-ignore: private field access required
        this._enabled = true;
        // already hooked, just call patch again
        // @ts-ignore: private field access required
        if (this._hooks.length > 0) {
            // @ts-ignore: private field access required
            for (const module of this._modules) {
                if (typeof module.patch === 'function' && module.moduleExports) {
                    this._diag.debug('Applying instrumentation patch for nodejs module on instrumentation enabled', {
                        module: module.name,
                        version: module.moduleVersion,
                    });
                    module.patch(module.moduleExports, module.moduleVersion);
                }
                for (const file of module.files) {
                    if (file.moduleExports) {
                        this._diag.debug('Applying instrumentation patch for nodejs module file on instrumentation enabled', {
                            module: module.name,
                            version: module.moduleVersion,
                            fileName: file.name,
                        });
                        file.patch(file.moduleExports, module.moduleVersion);
                    }
                }
            }
            return;
        }
        // @ts-ignore: private field access required
        this._warnOnPreloadedModules();

        // @ts-ignore: private field access required
        for (const module of this._modules) {
            const hookFn = (exports, name, baseDir) => {
                if (!baseDir && path.isAbsolute(name)) {
                    const parsedPath = path.parse(name);
                    name = parsedPath.name;
                    baseDir = parsedPath.dir;
                }

                // @ts-ignore: private field access required
                return this._onRequire(module, exports, name, baseDir);
            };

            const onRequire = (exports, name: string, baseDir: string) => {
                try {
                    if (module.name !== name && module.name.includes(path.join(baseDir, name))) {
                        // @ts-ignore: private field access required
                        return this._onRequire(module, exports, module.name, baseDir);
                    }
                    // @ts-ignore: private field access required
                    return this._onRequire(module, exports, module.name, baseDir);
                }
                catch (err) {
                    consoleLog("Error in onRequire", {
                        module: module.name,
                        name,
                        baseDir,
                        error: err.message,
                        stack: err.stack
                    });
                    return exports
                }
            };

            const hook = new RequireHook([module.name], { internals: true }, onRequire);
            // @ts-ignore: private field access required
            this._hooks.push(hook);
            const esmHook = new ImportHook([module.name], { internals: false }, hookFn);
            // @ts-ignore: private field access required
            this._hooks.push(esmHook);
        }
    }

    // Helper method to group packages by name
    _groupPackagesByName(packages) {
        const groups = {};

        for (const pkg of packages) {
            const key = `${pkg.package}_${pkg.object}_${pkg.method}`;
            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(pkg);
        }

        return groups;
    }

    _getOnPatchMain(elements) {
        return (moduleExports) => {
            try {
                // Handle single or multiple elements
                // const packageName = elements[0].package;

                if (elements.length === 1) {
                    const element = elements[0];
                    if (typeof moduleExports === "function") {
                        this._wrap(
                            moduleExports.prototype,
                            element.method,
                            this._patchMainMethodName(element)
                        );
                    }
                    if (!element.object) {
                        this._wrap(moduleExports, element.method, this._patchMainMethodName(element));
                    }
                    else {
                        this._wrap(
                            moduleExports[element.object].prototype,
                            element.method,
                            this._patchMainMethodName(element)
                        );
                    }
                } else {
                    // Add tracer to each element
                    const elementsWithTracer = elements.map(element => ({
                        ...element,
                        tracer: this.tracer
                    }));

                    if (typeof moduleExports === "function") {
                        this._wrap(
                            moduleExports.prototype,
                            elements[0].method,
                            getPatchedMainList(elementsWithTracer)
                        );
                    }
                    else {
                        this._wrap(
                            moduleExports[elements[0].object].prototype,
                            elements[0].method,
                            getPatchedMainList(elementsWithTracer)
                        );
                    }
                }
                return moduleExports;
            } catch (e) {
                consoleLog('Error in _getOnPatchMain', {
                    package: elements[0].package,
                    elements: elements.length,
                    error: e.message,
                    stack: e.stack
                });
                throw e;
            }
        }
    }

    _patchMainMethodName(element) {
        const tracer = this.tracer
        if (element.scopeName) {
            return getPatchedScopeMain({ tracer, ...element })
        }
        return getPatchedMain({ tracer, ...element })
    }
}

const setupMonocle = (
    workflowName: string,
    spanProcessors: SpanProcessor[] = [],
    wrapperMethods: any[] = [],
    exporter_list: string = null
) => {

    try {
        consoleLog(`Setting up Monocle for workflow: ${workflowName}`);
        if (spanProcessors.length && exporter_list) {
            throw new Error('Cannot set both spanProcessors and exporter_list.');
        }
        registerModule();

        const resource = resourceFromAttributes({
            SERVICE_NAME: workflowName
        });
        
        const contextManager = new AsyncHooksContextManager();
        contextManager.enable();
        context.setGlobalContextManager(contextManager);

        const monocleProcessors: SpanProcessor[] = [];
        if (!spanProcessors.length) {
            addSpanProcessors(monocleProcessors, exporter_list);
        }
        const finalSpanProcessors = [...spanProcessors, ...monocleProcessors];
        finalSpanProcessors.forEach(processor => {
            consoleLog(`Adding span processor: ${processor.constructor.name}`);
        });

        const tracerProvider = new NodeTracerProvider({
            resource: resource,
            spanProcessors: finalSpanProcessors
        })
        // for (let processor of spanProcessors)
        //     tracerProvider.addSpanProcessor(processor)
        const userWrapperMethods: any[] = []
        wrapperMethods.forEach((wrapperMethod: any[]) => {
            if (wrapperMethod) {
                userWrapperMethods.push({ ...wrapperMethod })
            }
        })
        const monocleInstrumentation = new MonocleInstrumentation({
            userWrapperMethods
        });

        setInstrumentor(monocleInstrumentation)

        monocleInstrumentation.setTracerProvider(tracerProvider);

        monocleInstrumentation.enable();

        consoleLog('Monocle setup completed');
        return monocleInstrumentation;
    } catch (e) {
        consoleLog('Error in setupMonocle', {
            workflowName,
            error: e.message,
            stack: e.stack
        });
        throw e;
    }
}

function addSpanProcessors(monocleProcessors: SpanProcessor[] = [], exporter_list:string = null) {
    consoleLog('Adding span processors, environment:', {
        MONOCLE_EXPORTER_DELAY: process.env.MONOCLE_EXPORTER_DELAY,
        MONOCLE_EXPORTER: process.env.MONOCLE_EXPORTER,
        isLambda: Object.prototype.hasOwnProperty.call(process.env, AWS_CONSTANTS.AWS_LAMBDA_FUNCTION_NAME)
    });
    const parsedDelay = parseInt(process.env.MONOCLE_EXPORTER_DELAY);
    const scheduledDelayMillis = !isNaN(parsedDelay) && parsedDelay >= 0 ? parsedDelay : 5;

    const exporters:string = exporter_list || process.env.MONOCLE_EXPORTER ;
    if (!exporters &&
        Object.prototype.hasOwnProperty.call(process.env, AWS_CONSTANTS.AWS_LAMBDA_FUNCTION_NAME)) {
        consoleLog(`addSpanProcessors| Using AWS S3 span exporter and Console span exporter`);
        monocleProcessors.push(
            new PatchedBatchSpanProcessor(
                new AWSS3SpanExporter({}),
                {
                    scheduledDelayMillis: scheduledDelayMillis
                }
            )

        )
        monocleProcessors.push(new PatchedBatchSpanProcessor(
            new ConsoleSpanExporter(),
            {
                scheduledDelayMillis: scheduledDelayMillis
            }
        ))
    }
    else {
        monocleProcessors.push(
            ...getMonocleExporters(exporters).map((exporter) => {
                return new PatchedBatchSpanProcessor(
                    exporter,
                    {
                        scheduledDelayMillis: scheduledDelayMillis
                    }
                )
            })
        )

    }
}


export function setScopes<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    scopes: Record<string, string | null>,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
) {
    return setScopesInternal(
        scopes,
        context.active(),
        fn,
        thisArg,
        ...args
    )
}
export function attachHeadersScopes<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    header: Record<string, string | null>,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
) {
    const scopes = Object.keys(header).reduce((acc, key) => {
        acc[key] = header[key];
        return acc;
    }, {} as Record<string, string | null>);

    return setScopes(scopes, fn, thisArg, ...args);
}
export function setScopesBind(
    scopes: Record<string, string | null>,
    fn: Function
): Function {
    const bindFn = setScopesBindInternal(
        scopes,
        context.active(),
        fn
    );
    return bindFn;
}

export function startTrace<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
) {
    return startTraceInternal(fn, thisArg, ...args);
}

export function getScopes(): Record<string, string> {
    return getScopesInternal();
}

export { setupMonocle };
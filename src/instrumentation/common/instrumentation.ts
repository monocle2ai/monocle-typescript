import { registerModule } from "./esmModule"


import {
    InstrumentationBase,
    InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import { context } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider, SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { combinedPackages, getBarePackageName } from "./packages";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { getPatchedMain, getPatchedScopeMain, getPatchedMainList } from "./wrapper";
// Must stay a static import: a lazy require() throws in the ESM build.
import { NonFrameworkSpanHandler } from "./spanHandler";
import { AWS_CONSTANTS, MethodConfig } from './constants';
import * as path from 'path';
import * as fs from 'fs';
import { Hook as ImportHook } from "import-in-the-middle";
import { loadMonocleEnvFile } from "../../common/envFile";
import { Hook as RequireHook } from "require-in-the-middle";
import { getMonocleExporters } from '../../exporters';
import { PatchedBatchSpanProcessor } from './opentelemetryUtils';
import { AWSS3SpanExporter } from '../../exporters/aws/AWSS3SpanExporter'
import { consoleLog } from '../../common/logging';
import { setScopesInternal, getScopesInternal, setScopesBindInternal, load_scopes, setInstrumentor, getInstrumentor, startTraceInternal } from './utils';

class MonocleInstrumentation extends InstrumentationBase {
    // `declare` (no runtime field): a real field would emit `this.x = undefined`
    // after super()/init() and wipe the Sets init() populates. Created in init().
    declare instrumentedPackages: Set<string>;   // configured to instrument
    declare hookedPackages: Set<string>;          // actually hooked (a patch fired)
    declare _auditDone?: boolean;

    constructor(config = {}) {
        super('MonocleInstrumentation', "1.0", config)
        consoleLog('MonocleInstrumentation initialized with config:', config);
    }

    public getTracer() {
        return this.tracer;
    }

    // Warn about instrumented direct-deps that were never hooked — usually a
    // bundler (Next.js) inlined them, so tracing silently produces nothing.
    // Runs once. Disable with MONOCLE_DISABLE_HOOK_AUDIT=true.
    public auditHooks() {
        if (this._auditDone) return;
        this._auditDone = true;
        try {
            if (process.env.MONOCLE_DISABLE_HOOK_AUDIT === 'true') return;
            // Bundler-only: in plain Node/tsx a missing hook just means "not loaded
            // yet", and tsx helper processes would false-positive.
            if (!process.env.NEXT_RUNTIME && process.env.MONOCLE_FORCE_HOOK_AUDIT !== 'true') return;
            if (!this.instrumentedPackages || !this.hookedPackages) return;

            let deps: Record<string, string> = {};
            try {
                const pkgPath = path.join(process.cwd(), 'package.json');
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                deps = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
            } catch {
                return; // no readable package.json → can't audit, stay silent
            }
            const directDeps = new Set(Object.keys(deps));

            const missing: string[] = [];
            for (const pkg of this.instrumentedPackages) {
                if (directDeps.has(pkg) && !this.hookedPackages.has(pkg)) missing.push(pkg);
            }
            if (missing.length) {
                console.warn(
                    `[monocle] Instrumented package(s) installed but not hooked: ${missing.join(', ')}. ` +
                    `If your app uses them under a bundler (Next.js/webpack), add them to serverExternalPackages ` +
                    `(or withMonocle's externalPackages) so they aren't inlined — bundled modules can't be traced. ` +
                    `Silence with MONOCLE_DISABLE_HOOK_AUDIT=true.`
                );
            }
        } catch (e) {
            consoleLog('Error in auditHooks', { error: (e as any)?.message });
        }
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
        this.instrumentedPackages = new Set();
        this.hookedPackages = new Set();
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
                // patch
                this._getOnPatchMain(elements).bind(this),
                // unpatch
                this._unPatch(elements).bind(this),
            );
            // Config for the ESM hook (enable()) to patch by export-presence.
            (module as any).monocleElements = elements;
            this.instrumentedPackages.add(getBarePackageName(elements[0].package));
            modules.push(module);
        }

        //  openai => chatcompletion.ts => Completion => create

        consoleLog(`Initialized ${modules.length} modules for instrumentation`);
        return modules;
    }

    _unPatch(elements: MethodConfig[]): (exports: any, moduleVersion?: string) => void {
        return (exports, _moduleVersion) => {
            try {
                if (elements.length === 1) {
                    const element = elements[0];
                    if (typeof exports === "function") {
                        this._unwrap(
                            exports.prototype,
                            element.method
                        );
                    }
                    if (!element.object) {
                        this._unwrap(exports, element.method);
                    }
                    else {
                        this._unwrap(
                            exports[element.object].prototype,
                            element.method
                        );
                    }
                } else {
                    if (typeof exports === "function") {
                        this._unwrap(
                            exports.prototype,
                            elements[0].method
                        );
                    }
                    else {
                        this._unwrap(
                            exports[elements[0].object].prototype,
                            elements[0].method
                        );
                    }
                }
            } catch (e) {
                consoleLog('Error in _unPatch', {
                    package: elements[0].package,
                    elements: elements.length,
                    error: e.message,
                    stack: e.stack
                });
            }
        };
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

            // IITM matches only the bare package name (it collapses subpaths like
            // "@mastra/core/agent" to "@mastra/core"), so hook the bare package with
            // `internals` and patch whichever internal module exposes the target.
            // (CJS works via require-in-the-middle's literal string match above.)
            const esmElements: MethodConfig[] = (module as any).monocleElements || [];
            const barePackage = getBarePackageName(module.name);
            const esmHook = new ImportHook([barePackage], { internals: true }, (exports) => {
                try {
                    const el = esmElements[0];
                    if (!el) return exports;
                    const target = el.object ? exports?.[el.object]?.prototype : exports;
                    // Skip modules without the target; __wrapped guards against
                    // double-wrapping (the class fires from both chunk and barrel).
                    if (!target || typeof target[el.method] !== "function") return exports;
                    if ((target[el.method] as any).__wrapped) return exports;
                    module.moduleExports = exports;
                    module.patch(exports, module.moduleVersion);
                } catch (err) {
                    consoleLog("Error in ESM hookFn", {
                        module: module.name,
                        error: err.message,
                        stack: err.stack
                    });
                }
                return exports;
            });
            // @ts-ignore: private field access required
            this._hooks.push(esmHook);
        }
    }

    // Helper method to group packages by name
    _groupPackagesByName(packages) {
        const groups: Record<string, any[]> = {};

        for (const pkg of packages) {
            const key = `${pkg.package}_${pkg.object}_${pkg.method}`;
            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(pkg);
        }

        return groups;
    }

    _getOnPatchMain(elements: MethodConfig[]): (moduleExports: any, moduleVersion?: string) => any {
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
                // Record a successful wrap for the hook audit.
                this.hookedPackages.add(getBarePackageName(elements[0].package));
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
    // make sure original and return function have same signature
    _patchMainMethodName(element: MethodConfig): (original: Function) => Function {
        const tracer = this.tracer
        if (element.scopeName || element.scopeValues) {
            return getPatchedScopeMain({ ...element })
        }
        // Check if element has a custom wrapper_method
        if ((element as any).wrapperMethod && typeof (element as any).wrapperMethod === 'function') {
            return (original: Function) => {
                return function (this: any, ...args: any[]) {
                    const spanHandler = (element as any).spanHandler || new NonFrameworkSpanHandler();

                    return (element as any).wrapperMethod(
                        tracer,
                        spanHandler,
                        element,
                        original,
                        this,
                        '',
                        args
                    );
                };
            };
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
        // Before anything reads configuration, and before consoleLog checks
        // MONOCLE_DEBUG. Next.js and mastra reach tracing through here rather
        // than through the register preload, so this is their only chance.
        loadMonocleEnvFile();

        consoleLog(`Setting up Monocle for workflow: ${workflowName}`);

        if (spanProcessors.length && exporter_list) {
            throw new Error('Cannot set both spanProcessors and exporter_list.');
        }

        // Set up once per process: `monocle2ai run` preloads the register entry
        // and the target file may call setupMonocle too, which would build a
        // second tracer provider and export every span twice.
        const existing = getInstrumentor();
        if (existing) {
            consoleLog(
                `Monocle is already set up; ignoring this call for workflow: ${workflowName}`
            );
            return existing;
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

        // Deferred hook audit, once. Timer is unref'd so it never holds a script open.
        if (process.env.MONOCLE_DISABLE_HOOK_AUDIT !== 'true') {
            const delayMs = Number(process.env.MONOCLE_HOOK_AUDIT_DELAY_MS ?? 20000);
            const timer = setTimeout(() => monocleInstrumentation.auditHooks(), delayMs);
            if (typeof (timer as any).unref === 'function') (timer as any).unref();
            process.on('beforeExit', () => monocleInstrumentation.auditHooks());
        }

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

function addSpanProcessors(monocleProcessors: SpanProcessor[] = [], exporter_list: string = null) {
    consoleLog('Adding span processors, environment:', {
        MONOCLE_EXPORTER_DELAY: process.env.MONOCLE_EXPORTER_DELAY,
        MONOCLE_EXPORTER: process.env.MONOCLE_EXPORTER,
        isLambda: Object.prototype.hasOwnProperty.call(process.env, AWS_CONSTANTS.AWS_LAMBDA_FUNCTION_NAME)
    });
    const parsedDelay = parseInt(process.env.MONOCLE_EXPORTER_DELAY);
    const scheduledDelayMillis = !isNaN(parsedDelay) && parsedDelay >= 0 ? parsedDelay : 5000;

    const exporters: string = exporter_list || process.env.MONOCLE_EXPORTER;
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
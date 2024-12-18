const {
    InstrumentationBase,
    InstrumentationNodeModuleDefinition,
} = require('@opentelemetry/instrumentation')
const { context } = require("@opentelemetry/api")
const { Resource } = require("@opentelemetry/resources")
const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node")
const { AsyncHooksContextManager } = require("@opentelemetry/context-async-hooks")
const { combinedPackages } = require("./common/packages")
const { BatchSpanProcessor, ConsoleSpanExporter } = require("@opentelemetry/sdk-trace-node")
const { getPatchedMain } = require("./wrapper")
const { AWS_CONSTANTS } = require('./constants')
const path = require('path')
const import_in_the_middle_1 = require("import-in-the-middle");
const require_in_the_middle_1 = require("require-in-the-middle");
const { AWSS3SpanExporter } = require('./exporters/aws/AWSS3SpanExporter')

class MonocleInstrumentation extends InstrumentationBase {
    constructor(config = {}) {
        super('MonocleInstrumentation', "1.0", config)
    }
    // modules = []

    /**
     * Init method will be called when the plugin is constructed.
     * It returns an `InstrumentationNodeModuleDefinition` which describes
     *   the node module to be instrumented and patched.
     * It may also return a list of `InstrumentationNodeModuleDefinition`s if
     *   the plugin should patch multiple modules or versions.
     */
    init() {
        const modules = []
        const packagesForInstrumentation = combinedPackages.concat(this._config.userWrapperMethods || [])
        packagesForInstrumentation.forEach(element => {
            const module = new InstrumentationNodeModuleDefinition(
                element.package,
                ['*'],
                this._getOnPatchMain({ ...element }).bind(this),
            );
            modules.push(module)
        })

        return modules;
    }

    enable() {
        if (this._enabled) {
            return;
        }
        this._enabled = true;
        // already hooked, just call patch again
        if (this._hooks.length > 0) {
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
        this._warnOnPreloadedModules();
        for (const module of this._modules) {
            const hookFn = (exports, name, baseDir) => {
                if (!baseDir && path.isAbsolute(name)) {
                    const parsedPath = path.parse(name);
                    name = parsedPath.name;
                    baseDir = parsedPath.dir;
                }
                return this._onRequire(module, exports, name, baseDir);
            };
            const onRequire = (exports, name, baseDir) => {
                return this._onRequire(module, exports, name, baseDir);
            };
            // `RequireInTheMiddleSingleton` does not support absolute paths.
            // For an absolute paths, we must create a separate instance of the
            // require-in-the-middle `Hook`.
            const hook = new require_in_the_middle_1.Hook([module.name], { internals: true }, onRequire);
            this._hooks.push(hook);
            const esmHook = new import_in_the_middle_1.Hook([module.name], { internals: false }, hookFn);
            this._hooks.push(esmHook);
        }
    }

    _getOnPatchMain(element) {
        return (moduleExports) => {
            this._wrap(
                moduleExports[element.object].prototype,
                element.method,
                this._patchMainMethodName(element)
            );
            return moduleExports;
        }
    }

    _patchMainMethodName(element) {
        const tracer = this.tracer
        return getPatchedMain({ tracer, ...element })
    }
}

const setupMonocle = (
    workflowName,
    spanProcessors = [],
    wrapperMethods = []
) => {
    const resource = new Resource({
        SERVICE_NAME: workflowName
    })
    const contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    const tracerProvider = new NodeTracerProvider({
        resource: resource
    })
    const monocleProcessors = [];
    if (!spanProcessors.length) {
        addSpanProcessors(monocleProcessors);
    }

    [...spanProcessors, ...monocleProcessors].forEach(processor => {
        // processor.onStart = onProcessorStart;
        tracerProvider.addSpanProcessor(processor);
    });
    // for (let processor of spanProcessors)
    //     tracerProvider.addSpanProcessor(processor)
    const userWrapperMethods = []
    wrapperMethods.forEach(wrapperMethod => {
        if (Array.isArray(wrapperMethod)) {
            userWrapperMethods.push(...wrapperMethod)
        }
    })
    const monocleInstrumentation = new MonocleInstrumentation({
        userWrapperMethods
    });

    monocleInstrumentation.setTracerProvider(tracerProvider);
    monocleInstrumentation.enable();
}

function addSpanProcessors(okahuProcessors = []) {
    if (Object.prototype.hasOwnProperty.call(process.env, AWS_CONSTANTS.AWS_LAMBDA_FUNCTION_NAME)) {
        okahuProcessors.push(new BatchSpanProcessor(new AWSS3SpanExporter({})))
        okahuProcessors.push(new BatchSpanProcessor(new ConsoleSpanExporter()))
    }
}

exports.setupMonocle = setupMonocle
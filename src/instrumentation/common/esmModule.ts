import * as module_private_1 from 'module'
import { consoleLog } from '../../common/logging'
import { pathToFileURL } from 'url'
import { isVercelEnvironment } from './utils'

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Keep TypeScript sources away from import-in-the-middle: on Node's
// CommonJS-then-reparse path IITM claims the file before native type
// stripping, so TS syntax reaches V8 and throws. Only node_modules needs
// wrapping, plus the project files named in the custom instrumentation config.
function typeScriptExclude(allowedFiles: string[]): RegExp {
    if (!allowedFiles.length) return /\.[cm]?tsx?($|\?)/
    const allowed = allowedFiles.map(file => escapeRegExp(pathToFileURL(file).href)).join('|')
    return new RegExp(`^(?!(?:${allowed})(?:\\?|$)).*\\.[cm]?tsx?($|\\?)`)
}

// allowedFiles: absolute paths of project files that must be wrapped.
export function registerModule(allowedFiles: string[] = []) {
    // @esm-only

    const TYPESCRIPT_SOURCE = typeScriptExclude(allowedFiles)

    // openai v4 keeps its shims in module-level state. Wrapping _shims hands the
    // writer and the reader different instances, so core.mjs sees an uninitialised
    // registry and throws. Nothing there is instrumented, so skipping costs nothing.
    const OPENAI_SHIMS = /[\\/]openai[\\/]_shims[\\/]/

    try {
        consoleLog("registering import-in-the-middle/hook.mjs")

        import('import-in-the-middle/hook.mjs')

        if (isVercelEnvironment()) {
            module_private_1.register('import-in-the-middle/hook.mjs', "file:///var/task/node_modules", {
                data: { exclude: [TYPESCRIPT_SOURCE, OPENAI_SHIMS] }
            })
        }
        else {
            // @ts-ignore
            module_private_1.register('import-in-the-middle/hook.mjs', import.meta.url, {
                data: { exclude: [TYPESCRIPT_SOURCE, OPENAI_SHIMS] }
            })
        }
    }
    catch (e) {
        consoleLog("Error registering import-in-the-middle/hook.mjs", e)
    }

    // @end-esm-only
}

import * as module_private_1 from 'module'
import { consoleLog } from '../../common/logging'
import { isVercelEnvironment } from './utils'

export function registerModule() {
    // @esm-only

    // Keep TypeScript sources away from import-in-the-middle: on Node's
    // CommonJS-then-reparse path IITM claims the file before native type
    // stripping, so TS syntax reaches V8 and throws. Only node_modules needs wrapping.
    const TYPESCRIPT_SOURCE = /\.[cm]?tsx?($|\?)/

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

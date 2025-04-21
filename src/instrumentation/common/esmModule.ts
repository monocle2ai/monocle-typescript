import * as module_private_1 from 'module'
import { consoleLog } from '../../common/logging'
import { isVercelEnvironment } from './utils'

export function registerModule() {
    // @esm-only
    try {
        consoleLog("registering import-in-the-middle/hook.mjs")

        import('import-in-the-middle/hook.mjs')

        if (isVercelEnvironment()) {
            module_private_1.register('import-in-the-middle/hook.mjs', "file:///var/task/node_modules")
        }
        else {
            // @ts-ignore
            module_private_1.register('import-in-the-middle/hook.mjs', import.meta.url)
        }
    }
    catch (e) {
        consoleLog("Error registering import-in-the-middle/hook.mjs", e)
    }

    // @end-esm-only
}

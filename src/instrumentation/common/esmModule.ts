import * as module_private_1 from 'module'
import { consoleLog } from '../../common/logging'


// @ts-ignore
export function registerModule() {
    consoleLog("registering import-in-the-middle/hook.mjs")
    // @ts-ignore
    module_private_1.register('import-in-the-middle/hook.mjs', import.meta.url)
}

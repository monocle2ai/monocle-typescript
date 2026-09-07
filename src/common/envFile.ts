import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import { consoleLog } from "./logging";

/** Monocle's own settings file, kept out of the app's .env. */
export const MONOCLE_ENV_FILE = ".env.monocle";

export type EnvFileOutcome = "loaded" | "absent" | "unsupported" | "failed";

/**
 * Load Monocle's settings from .env.monocle.
 *
 * This is where Monocle's settings live, so the file is authoritative and its
 * values replace whatever is already in the environment. Deferring to what was
 * set earlier is not an option: the preload runs in every process tsx spawns
 * and only the last of them applies --env-file, so a value from .env would win
 * under plain node and lose under tsx for the very same project. The app's own
 * .env carries NODE_OPTIONS and nothing Monocle reads.
 *
 * Parsed with Node's own .env parser, so this file and --env-file can never
 * disagree about what a line means.
 *
 * Every failure is reported rather than thrown. The file is optional, and
 * tracing must not break because it is missing, unreadable, or unsupported.
 */
export function loadMonocleEnvFile(dir: string = process.cwd()): EnvFileOutcome {
    const file = path.join(dir, MONOCLE_ENV_FILE);

    // parseEnv arrived in Node 20.12 / 21.7; older runtimes go without. Reached
    // through the namespace: a named import of a missing builtin export is a
    // load-time SyntaxError in ESM, which would take the preload down with it.
    if (typeof util.parseEnv !== "function") {
        consoleLog(`[monocle] this Node cannot read ${MONOCLE_ENV_FILE}`);
        return "unsupported";
    }
    if (!fs.existsSync(file)) {
        return "absent";
    }

    try {
        const settings = util.parseEnv(fs.readFileSync(file, "utf8"));
        for (const [key, value] of Object.entries(settings)) {
            if (typeof value === "string") {
                process.env[key] = value;
            }
        }
        consoleLog(`[monocle] loaded settings from ${file}`);
        return "loaded";
    } catch (err) {
        consoleLog(`[monocle] could not read ${file}: ${String(err)}`);
        return "failed";
    }
}

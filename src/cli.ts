import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parseArgs, USAGE } from "./cli/args";
import { buildRunPlan, resolveRunnerCommand, RunPlan } from "./cli/runPlan";
import { MONOCLE_VERSION } from "./instrumentation/common/monocle_version";

const HELP = `monocle2ai — run a script with Monocle tracing enabled.

${USAGE}

  --version    Print the Monocle version.
  --help       Show this message.

Tracing is preloaded before your code runs, so the target file needs no edits.
Set MONOCLE_WORKFLOW_NAME to name the workflow (defaults to the package name).`;

export interface RunOutcome {
    code: number;
    /** Set when the runner itself could not be started, as opposed to failing. */
    spawnError?: string;
}

/**
 * Run the target. All three streams are inherited so the script stays fully
 * interactive and its output is never buffered or reordered.
 *
 * Node emits only EACCES, EAGAIN, EMFILE, ENFILE and ENOENT as 'error' events
 * and throws every other spawn failure, so the call is guarded: an unguarded
 * throw escapes this executor and reaches the user as a raw Node stack.
 */
export function runOnce(
    plan: RunPlan,
    execPath: string = process.execPath
): Promise<RunOutcome> {
    return new Promise((resolve) => {
        const command = resolveRunnerCommand(plan.cwd, execPath);
        if (command.usedNpx) {
            console.error(
                "[monocle] tsx is not installed here; running it through npx. " +
                "Your project is left untouched."
            );
        }
        let child;
        try {
            child = spawn(command.bin, [...command.prefixArgs, ...plan.args], {
                cwd: plan.cwd,
                stdio: "inherit",
                env: process.env,
            });
        } catch (err) {
            resolve({ code: 1, spawnError: (err as Error).message });
            return;
        }

        child.on("error", (err) => resolve({ code: 1, spawnError: err.message }));
        child.on("close", (code) => resolve({ code: code ?? 1 }));
    });
}

/**
 * `monocle2ai run` is the only interface a user should need, so this points
 * back at the same command rather than at the preload it uses internally.
 */
export function missingTsxMessage(file: string, detail = ""): string {
    return (
        `[monocle] ${path.basename(file)} needs the tsx runner, ` +
        "and it could not be started.\n" +
        (detail ? `          ${detail.trim()}\n` : "") +
        "          Install it:  npm install -D tsx\n" +
        `          Then re-run:  npx monocle2ai run ${file}`
    );
}

export async function main(argv: string[]): Promise<number> {
    const parsed = parseArgs(argv);

    if (parsed.command === "help") {
        console.log(HELP);
        return 0;
    }
    if (parsed.command === "version") {
        console.log(MONOCLE_VERSION);
        return 0;
    }
    if (parsed.command === "error") {
        console.error(parsed.message);
        return 1;
    }

    const file = parsed.file as string;
    if (!fs.existsSync(file)) {
        console.error(`File not found: ${file}`);
        return 1;
    }

    const outcome = await runOnce(buildRunPlan(file, parsed.userArgs));
    if (outcome.spawnError) {
        console.error(missingTsxMessage(file, outcome.spawnError));
    }
    return outcome.code;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
    process.exitCode = await main(argv);
}

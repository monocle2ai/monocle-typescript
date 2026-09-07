export type Command = "run" | "help" | "version" | "error";

export interface ParsedArgs {
    command: Command;
    /** Target script, for `run`. */
    file?: string;
    /** Everything after the target — passed through untouched. */
    userArgs: string[];
    /** Explanation, when command is "error". */
    message?: string;
}

const USAGE = "Usage: monocle2ai run <file> [args...]";

/**
 * Parse CLI arguments. Everything after the target file is passed to the
 * script untouched, so a target with flags of its own still works.
 */
export function parseArgs(argv: string[]): ParsedArgs {
    const empty = { userArgs: [] as string[] };

    if (argv.length === 0) {
        return { command: "help", ...empty };
    }

    const [head, ...rest] = argv;

    if (head === "--help" || head === "-h" || head === "help") {
        return { command: "help", ...empty };
    }
    if (head === "--version" || head === "-v") {
        return { command: "version", ...empty };
    }
    if (head !== "run") {
        return {
            command: "error",
            message: `Unknown command "${head}". ${USAGE}`,
            ...empty,
        };
    }

    const [file, ...userArgs] = rest;
    if (!file) {
        return { command: "error", message: `No file given. ${USAGE}`, userArgs: [] };
    }

    return { command: "run", file, userArgs };
}

export { USAGE };

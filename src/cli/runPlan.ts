import * as fs from "fs";
import * as path from "path";

export type PreloadFlag = "--import" | "--require";

export interface RunPlan {
    /** Full argument list, preload flag first and user args last. */
    args: string[];
    /** Directory to run from — tsconfig discovery and module resolution depend on it. */
    cwd: string;
}

// The one target import-in-the-middle cannot take through --import: it throws
// "is not in cache". Every other extension loads correctly that way under tsx.
const REQUIRE_PRELOAD_EXTENSIONS = [".cts"];

/**
 * Which preload flag to use. tsx compiles the target either way, so the file's
 * own module system no longer matters — only .cts needs --require.
 */
export function preloadFlagFor(filePath: string): PreloadFlag {
    const ext = path.extname(filePath).toLowerCase();
    return REQUIRE_PRELOAD_EXTENSIONS.includes(ext) ? "--require" : "--import";
}

/** Directory of the nearest package.json, or the file's own directory. */
export function projectDirFor(filePath: string): string {
    const fileDir = path.dirname(path.resolve(filePath));
    let dir = fileDir;
    for (;;) {
        if (fs.existsSync(path.join(dir, "package.json"))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return fileDir;
        }
        dir = parent;
    }
}

/**
 * Locate tsx's own JS entry point, walking up from `startDir` the way module
 * resolution does — package managers hoist dependencies to the workspace root.
 * We resolve the package rather than node_modules/.bin deliberately: those are
 * shell shims, and Windows ships tsx.cmd, which Node refuses to spawn.
 */
export function findTsxEntry(startDir: string): string | undefined {
    let dir = path.resolve(startDir);
    for (;;) {
        const entry = binEntryOf(path.join(dir, "node_modules", "tsx"));
        if (entry) {
            return entry;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

/** Resolve a package's `bin` field to an existing file, in either declared form. */
function binEntryOf(pkgDir: string): string | undefined {
    let bin: unknown;
    try {
        bin = JSON.parse(
            fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")
        ).bin;
    } catch {
        return undefined;
    }
    const rel =
        typeof bin === "string"
            ? bin
            : bin && typeof bin === "object"
              ? Object.values(bin as Record<string, string>)[0]
              : undefined;
    if (typeof rel !== "string") {
        return undefined;
    }
    const entry = path.join(pkgDir, rel);
    return fs.existsSync(entry) ? entry : undefined;
}

/**
 * Find the npx script npm ships, so the fallback can run through node too.
 * Windows keeps npm beside the binary and POSIX keeps it under ../lib, and
 * every mainstream installer and version manager uses one of the two.
 */
export function findNpxCli(execPath: string = process.execPath): string | undefined {
    const dir = path.dirname(execPath);
    return [
        path.join(dir, "node_modules", "npm", "bin", "npx-cli.js"),
        path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
    ].find((candidate) => fs.existsSync(candidate));
}

export interface RunnerCommand {
    /** Executable to spawn. */
    bin: string;
    /** Arguments that must precede the run arguments. */
    prefixArgs: string[];
    /** Whether tsx is being fetched on the fly rather than run from the project. */
    usedNpx: boolean;
}

/**
 * Resolve how to invoke tsx, through the running node binary so that no shell
 * shim is spawned: Node returns EINVAL rather than executing a .cmd or .bat
 * without a shell, which is how this failed on Windows. The result no longer
 * varies by platform.
 *
 * When tsx is not installed we fetch it with npx rather than refusing — that
 * serves it from a user-level cache and leaves package.json, the lockfile and
 * node_modules untouched. Bare "npx" is the last resort, for the rare layout
 * where npm is not beside node; it works on POSIX, and on Windows the CLI
 * turns the resulting failure into install guidance.
 */
export function resolveRunnerCommand(
    cwd: string,
    execPath: string = process.execPath
): RunnerCommand {
    const tsx = findTsxEntry(cwd);
    if (tsx) {
        return { bin: execPath, prefixArgs: [tsx], usedNpx: false };
    }
    const npxCli = findNpxCli(execPath);
    return npxCli
        ? { bin: execPath, prefixArgs: [npxCli, "--yes", "tsx"], usedNpx: true }
        : { bin: "npx", prefixArgs: ["--yes", "tsx"], usedNpx: true };
}

/**
 * Decide how to run `filePath` with Monocle tracing preloaded. Everything goes
 * through tsx: it handles every module system and TypeScript feature Node's
 * strip-only mode cannot, for ~170ms against a multi-second tracing startup.
 */
export function buildRunPlan(filePath: string, userArgs: string[]): RunPlan {
    const resolved = path.resolve(filePath);
    return {
        args: [
            preloadFlagFor(resolved),
            "monocle2ai/register",
            resolved,
            ...userArgs,
        ],
        cwd: projectDirFor(resolved),
    };
}

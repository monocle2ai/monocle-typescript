import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";
import {
    CUSTOM_INSTRUMENTATION_DIR,
    CUSTOM_INSTRUMENTATION_FILE,
    CUSTOM_INSTRUMENTATION_PATH_ENV,
    MethodConfig,
} from "./constants";
import { buildCustomSpanProcessor } from "./customSpanProcessor";

// Extensions tried, in order, when a project path leaves its extension out.
const EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

// Resolves a project path (./src/svc) to the real file, so it matches the path
// the module hooks see. npm package names are returned as they are.
function resolvePackage(pkg: string, cwd: string): string | null {
    if (!pkg.startsWith(".") && !path.isAbsolute(pkg)) return pkg;
    const base = path.resolve(cwd, pkg);
    const candidates = [
        base,
        ...EXTENSIONS.map(ext => base + ext),
        ...EXTENSIONS.map(ext => path.join(base, "index" + ext)),
    ];
    const found = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    return found ? fs.realpathSync(found) : null;
}

// Reads <cwd>/.monocle/custom_instrumentation.yaml and returns its entries as
// method configs. A missing file is not an error; anything wrong inside it is
// warned about and skipped, so a bad config never stops the app.
export function loadCustomInstrumentation(cwd: string = process.cwd()): MethodConfig[] {
    const dir = process.env[CUSTOM_INSTRUMENTATION_PATH_ENV] || CUSTOM_INSTRUMENTATION_DIR;
    const configPath = path.resolve(cwd, dir, CUSTOM_INSTRUMENTATION_FILE);
    if (!fs.existsSync(configPath)) return [];

    let config: any;
    try {
        config = parse(fs.readFileSync(configPath, "utf8")) || {};
    } catch (e) {
        console.warn(`[monocle] Could not read ${configPath}: ${(e as Error).message}`);
        return [];
    }

    const methods: MethodConfig[] = [];
    for (const entry of config.instrument || []) {
        if (!entry?.package || !entry?.method) {
            console.warn(`[monocle] Skipping custom instrumentation entry without package and method: ${JSON.stringify(entry)}`);
            continue;
        }
        const pkg = resolvePackage(String(entry.package), cwd);
        if (!pkg) {
            console.warn(`[monocle] Skipping custom instrumentation for ${entry.package}: file not found from ${cwd}`);
            continue;
        }
        methods.push({
            package: pkg,
            object: entry.class || "",
            method: entry.method,
            spanName: entry.span_name,
            output_processor: [buildCustomSpanProcessor(entry.exclude)],
            fromConfigFile: true,
        });
    }
    return methods;
}

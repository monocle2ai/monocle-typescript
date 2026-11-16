import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";
import { MONOCLE_INSTRUCTION_ENV } from "../instrumentation/common/constants";

// Text Monocle adds to every model call, on top of the developer's prompt.
export interface Instruction {
    name: string;
    text: string;
}

const INSTRUCTION_FILE_KEYS = ["name", "description", "instruction"] as const;

const loaded = new Map<string, Instruction>();

// The instruction named by MONOCLE_INSTRUCTION, or null when it is not set.
export function instructionInEffect(): Instruction | null {
    const file = process.env[MONOCLE_INSTRUCTION_ENV]?.trim();
    return file ? loadInstruction(file) : null;
}

// Reads an instruction file once per path. Throws, naming the file, if it is missing or invalid.
export function loadInstruction(file: string): Instruction {
    const cached = loaded.get(file);
    if (cached) {
        return cached;
    }
    const instruction = readInstruction(file);
    loaded.set(file, instruction);
    return instruction;
}

function readInstruction(file: string): Instruction {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        throw new Error(`Instruction file ${file} was not found.`);
    }
    let fields: unknown;
    try {
        fields = parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
        throw new Error(`Instruction file ${file} is not valid YAML: ${e.message}`);
    }
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        throw new Error(`Instruction file ${file} must hold a name, a description and an instruction.`);
    }
    const values = fields as Record<string, unknown>;
    for (const key of INSTRUCTION_FILE_KEYS) {
        const value = values[key];
        if (typeof value !== "string" || !value.trim()) {
            throw new Error(`Instruction file ${file} has no '${key}'.`);
        }
    }
    const name = values.name as string;
    const fileName = path.parse(file).name;
    if (name !== fileName) {
        throw new Error(`Instruction file ${file} is named '${name}'; the name must match the file name.`);
    }
    return { name, text: (values.instruction as string).trim() };
}

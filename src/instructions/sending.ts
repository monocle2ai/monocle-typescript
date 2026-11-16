import { context } from "@opentelemetry/api";
import { INSTRUCTION_INPUT_LABEL, SENT_INSTRUCTION, SPAN_TYPES, WrapperArguments } from "../instrumentation/common/constants";
import { Span } from "../instrumentation/common/opentelemetryUtils";
import { Instruction, instructionInEffect } from "./instruction";

// An entity's add_instruction: the call's first argument with the instruction
// added, as a new object, or null when this call cannot carry it.
export type AddInstruction = (params: any, text: string) => any | null;

// Calls built by instructedCall, and spans whose call sent an instruction.
const instructionOfCall = new WeakMap<Function, Instruction>();
const instructionOfSpan = new WeakMap<object, { instruction: Instruction; fromOuterLayer: boolean }>();

// Set while an instructed call runs, so a wrapped call beneath it (e.g.
// Responses.stream calling create) knows its args already hold the instruction.
const OUTER_INSTRUCTION_KEY = Symbol("monocle.instruction_sent");

// The method to call at this wrap site: one that sends the instruction in
// effect, or the original when the entity or the call cannot carry it.
export function instructedCall(element: WrapperArguments, original: Function, args: ArrayLike<any>): Function {
    const addInstruction: AddInstruction | undefined = element.output_processor?.[0]?.add_instruction;
    if (typeof addInstruction !== "function") {
        return original;
    }
    let instruction: Instruction | null = null;
    try {
        instruction = instructionInEffect();
        if (!instruction) {
            return original;
        }
        const params = addInstruction(args[0], instruction.text);
        if (params === null || params === undefined) {
            return original;
        }
        const instructedArgs = [params, ...Array.prototype.slice.call(args, 1)];
        const sent = instruction;
        const call = function (this: any) {
            const callContext = context.active().setValue(OUTER_INSTRUCTION_KEY, sent);
            return context.with(callContext, () => original.apply(this, instructedArgs));
        };
        instructionOfCall.set(call, instruction);
        return call;
    } catch (e) {
        console.warn(`Monocle: instruction '${instruction?.name}' was not added to the model call: ${e}`);
        return original;
    }
}

// Marks the span whose call sent an instruction.
export function recordSentInstruction(call: Function, span: Span): void {
    const instruction = instructionOfCall.get(call);
    if (instruction) {
        const fromOuterLayer = context.active().getValue(OUTER_INSTRUCTION_KEY) !== undefined;
        instructionOfSpan.set(span, { instruction, fromOuterLayer });
        span.setAttribute(SENT_INSTRUCTION, instruction.name);
    }
}

// The span's input messages, with the instruction its call carries listed first.
// A framework inference span carries the one in effect: the model SDK call
// beneath it is the one that adds it.
export function inputWithInstruction(input: any[], span: Span, spanType: string): any[] {
    const sent = instructionOfSpan.get(span);
    let instruction = sent?.instruction;
    if (!instruction && spanType === SPAN_TYPES.INFERENCE_FRAMEWORK) {
        try {
            instruction = instructionInEffect();
        } catch {
            instruction = null;
        }
    }
    if (!instruction) {
        return input;
    }
    const developerInput = sent?.fromOuterLayer ? withoutInstruction(input, instruction.text) : input;
    return [JSON.stringify({ [INSTRUCTION_INPUT_LABEL]: instruction.text }), ...developerInput];
}

// Input read from args an outer layer already instructed: drop the text it put
// ahead of a system prompt, and any message that is only the instruction.
function withoutInstruction(input: any[], text: string): any[] {
    return input
        .map((message) => typeof message === "string" ? message.split(`${text}\n\n`).join("") : message)
        .filter((message) => typeof message !== "string" || !message.includes(text));
}

// A chat call with the instruction as its first system message, or null when it has no messages.
export function addSystemMessage(params: any, text: string): any | null {
    const messages = params?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
        return null;
    }
    const first = messages[0];
    if (first?.role === "system" && first?.content === text) {
        return params;
    }
    return { ...params, messages: [{ role: "system", content: text }, ...messages] };
}

// The instruction followed by the developer's system prompt. Null when that
// prompt is not text, so it is never replaced.
export function instructionBefore(text: string, systemPrompt: unknown): string | null {
    if (!systemPrompt) {
        return text;
    }
    if (typeof systemPrompt !== "string") {
        return null;
    }
    if (systemPrompt === text || systemPrompt.startsWith(`${text}\n\n`)) {
        return systemPrompt;
    }
    return `${text}\n\n${systemPrompt}`;
}

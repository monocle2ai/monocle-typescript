import { describe, it, expect } from 'vitest';
import {
    GEMINI_FINISH_REASON_MAPPING,
    mapGeminiFinishReasonToFinishType,
    FinishType,
} from '../../src/instrumentation/metamodel/finishType';
import { config as geminiInferenceConfig } from '../../src/instrumentation/metamodel/gemini/entities/inference';

// =============================================================================
// Gemini finish-reason → finish-type mapping
// =============================================================================
describe('Gemini finish-reason mapping', () => {
    it('maps STOP to success', () => {
        expect(mapGeminiFinishReasonToFinishType('STOP')).toBe(FinishType.SUCCESS);
    });

    it('maps FUNCTION_CALL to tool_call', () => {
        expect(mapGeminiFinishReasonToFinishType('FUNCTION_CALL')).toBe(FinishType.TOOL_CALL);
    });

    it('maps MALFORMED_FUNCTION_CALL to tool_call_error', () => {
        expect(mapGeminiFinishReasonToFinishType('MALFORMED_FUNCTION_CALL')).toBe(FinishType.TOOL_CALL_ERROR);
    });

    it('maps MAX_TOKENS to truncated', () => {
        expect(mapGeminiFinishReasonToFinishType('MAX_TOKENS')).toBe(FinishType.TRUNCATED);
    });

    it('maps SAFETY and RECITATION to content_filter', () => {
        expect(mapGeminiFinishReasonToFinishType('SAFETY')).toBe(FinishType.CONTENT_FILTER);
        expect(mapGeminiFinishReasonToFinishType('RECITATION')).toBe(FinishType.CONTENT_FILTER);
    });

    it('maps OTHER to error', () => {
        expect(mapGeminiFinishReasonToFinishType('OTHER')).toBe(FinishType.ERROR);
    });

    it('returns null for FINISH_REASON_UNSPECIFIED', () => {
        expect(mapGeminiFinishReasonToFinishType('FINISH_REASON_UNSPECIFIED')).toBeNull();
    });

    it('returns null for unknown values', () => {
        expect(mapGeminiFinishReasonToFinishType('NOT_A_REAL_REASON')).toBeNull();
    });

    it('returns null for null input', () => {
        expect(mapGeminiFinishReasonToFinishType(null)).toBeNull();
    });

    it('mapping table contains both new entries explicitly', () => {
        // Guard against accidental removal of the new mappings during refactors.
        expect(GEMINI_FINISH_REASON_MAPPING['FUNCTION_CALL']).toBe(FinishType.TOOL_CALL);
        expect(GEMINI_FINISH_REASON_MAPPING['MALFORMED_FUNCTION_CALL']).toBe(FinishType.TOOL_CALL_ERROR);
    });
});

// =============================================================================
// Gemini inference schema's dynamic subtype classifier
// =============================================================================
describe('Gemini inference schema.subtype classifier', () => {
    // Schema exports the subtype as a callable that takes { response } and
    // returns "tool_call" or "turn_end". We invoke it directly with synthetic
    // Gemini-shaped responses.
    const classify = (response: any): string => {
        const subtypeFn = geminiInferenceConfig.subtype as any;
        return subtypeFn({ response });
    };

    it('subtype is exposed as a function on the schema', () => {
        expect(typeof geminiInferenceConfig.subtype).toBe('function');
    });

    it('classifies a plain text response as turn_end', () => {
        const response = {
            candidates: [{
                finishReason: 'STOP',
                content: { parts: [{ text: 'hello world' }] },
            }],
        };
        expect(classify(response)).toBe('turn_end');
    });

    it('classifies a function-call response as tool_call (even when finishReason is STOP)', () => {
        // This is the critical case: Gemini still emits finishReason="STOP"
        // for tool-call responses, so the classifier MUST detect via content,
        // not via finishReason alone.
        const response = {
            candidates: [{
                finishReason: 'STOP',
                content: {
                    parts: [{ functionCall: { name: 'book_flight', args: { from: 'SFO' } } }],
                },
            }],
        };
        expect(classify(response)).toBe('tool_call');
    });

    it('classifies a mixed text+functionCall response as tool_call', () => {
        // If ANY part is a function call, the whole response is treated as
        // tool_call — interleaved text alongside the call doesn't change that.
        const response = {
            candidates: [{
                finishReason: 'STOP',
                content: {
                    parts: [
                        { text: 'Let me look that up.' },
                        { functionCall: { name: 'book_flight' } },
                    ],
                },
            }],
        };
        expect(classify(response)).toBe('tool_call');
    });

    it('classifies a truncated response as turn_end', () => {
        const response = {
            candidates: [{
                finishReason: 'MAX_TOKENS',
                content: { parts: [{ text: 'partial output…' }] },
            }],
        };
        expect(classify(response)).toBe('turn_end');
    });

    it('classifies a MALFORMED_FUNCTION_CALL as turn_end (tool_call_error ≠ tool_call)', () => {
        // Maps to TOOL_CALL_ERROR finish type, which is NOT equal to "tool_call",
        // so the classifier's only-when-tool_call branch doesn't fire.
        const response = {
            candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }],
        };
        expect(classify(response)).toBe('turn_end');
    });

    it('classifies a SAFETY-blocked response as turn_end', () => {
        const response = {
            candidates: [{
                finishReason: 'SAFETY',
                content: { parts: [] },
            }],
        };
        expect(classify(response)).toBe('turn_end');
    });

    it('gracefully falls back to turn_end on missing finishReason', () => {
        const response = {
            candidates: [{ content: { parts: [{ text: 'no reason field' }] } }],
        };
        expect(classify(response)).toBe('turn_end');
    });

    it('gracefully falls back to turn_end on empty response object', () => {
        expect(classify({})).toBe('turn_end');
    });

    it('gracefully falls back to turn_end on null response', () => {
        expect(classify(null)).toBe('turn_end');
    });
});

// =============================================================================
// data.input — system instruction + user message extraction
// =============================================================================
describe('Gemini inference data.input extraction', () => {
    // Resolve the data.input "input" accessor from the schema and invoke it the
    // way the instrumentation does: with { args }, where args is the call's
    // argument list (args[0] === the genai params object).
    const inputAccessor = (() => {
        const event = (geminiInferenceConfig.events as any[]).find((e) => e.name === 'data.input');
        const attr = event.attributes.find((a: any) => a.attribute === 'input');
        return attr.accessor as (ctx: { args: any[] }) => string[];
    })();

    const extractInput = (params: any) => inputAccessor({ args: [params] });

    it('captures a string systemInstruction ahead of the user message', () => {
        const input = extractInput({
            config: { systemInstruction: 'You are a travel agent.' },
            contents: [{ role: 'user', parts: [{ text: 'book me a flight' }] }],
        });
        expect(input).toEqual([
            JSON.stringify({ system: 'You are a travel agent.' }),
            JSON.stringify({ user: 'book me a flight' }),
        ]);
    });

    it('flattens a Content-shaped systemInstruction (parts)', () => {
        const input = extractInput({
            config: { systemInstruction: { role: 'system', parts: [{ text: 'Be concise.' }, { text: 'Be kind.' }] } },
            contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        });
        expect(input[0]).toBe(JSON.stringify({ system: 'Be concise. Be kind.' }));
    });

    it('reads systemInstruction from the top-level param as a fallback', () => {
        const input = extractInput({
            systemInstruction: 'Top-level system prompt.',
            contents: 'hello',
        });
        expect(input[0]).toBe(JSON.stringify({ system: 'Top-level system prompt.' }));
    });

    it('preserves the system message when contents is a bare string', () => {
        const input = extractInput({
            config: { systemInstruction: 'sys' },
            contents: 'just a string',
        });
        expect(input).toEqual([JSON.stringify({ system: 'sys' }), 'just a string']);
    });

    it('omits the system entry when no systemInstruction is present', () => {
        const input = extractInput({
            contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        });
        expect(input).toEqual([JSON.stringify({ user: 'hi' })]);
    });
});

// =============================================================================
// entity attributes — tools declared on the request (3rd entity group)
// =============================================================================
describe('Gemini inference tools entity', () => {
    // The 3rd entity attribute group carries the declared tools: a `name`
    // (comma-separated tool names) and a `type` ("tool.function"). Extraction reads
    // the standard @google/genai functionDeclarations shape, so it is
    // framework-agnostic — the names below are plain genai tool names, not
    // anything ADK-specific (ADK just happens to prefix its own tool names).
    const toolsGroup = (geminiInferenceConfig.attributes as any[])[2];
    const nameAccessor = toolsGroup.find((a: any) => a.attribute === 'name').accessor as (ctx: { args: any[] }) => any;
    const typeAccessor = toolsGroup.find((a: any) => a.attribute === 'type').accessor as (ctx: { args: any[] }) => any;

    const names = (params: any) => nameAccessor({ args: [params] });
    const type = (params: any) => typeAccessor({ args: [params] });

    it('extracts function tool names from config.tools (genai shape)', () => {
        const params = {
            model: 'gemini-2.5-flash',
            config: {
                tools: [{ functionDeclarations: [{ name: 'book_flight' }] }],
            },
        };
        expect(names(params)).toBe('book_flight');
        expect(type(params)).toBe('tool.function');
    });

    it('collects names across multiple declarations and tool groups', () => {
        const params = {
            config: {
                tools: [
                    { functionDeclarations: [{ name: 'book_flight' }, { name: 'cancel_flight' }] },
                    { functionDeclarations: [{ name: 'check_status' }] },
                ],
            },
        };
        expect(names(params)).toBe('book_flight, cancel_flight, check_status');
        expect(type(params)).toBe('tool.function');
    });

    it('reads tools from the top-level params.tools fallback (snake_case declarations)', () => {
        const params = {
            tools: [{ function_declarations: [{ name: 'get_weather' }] }],
        };
        expect(names(params)).toBe('get_weather');
        expect(type(params)).toBe('tool.function');
    });

    it('returns undefined (entity skipped) when no tools are declared', () => {
        const params = { model: 'gemini-2.5-flash', contents: 'hi' };
        expect(names(params)).toBeUndefined();
        expect(type(params)).toBeUndefined();
    });
});

// =============================================================================
// data.output — text vs function-call response extraction
// =============================================================================
describe('Gemini inference data.output extraction', () => {
    const responseAccessor = (() => {
        const event = (geminiInferenceConfig.events as any[]).find((e) => e.name === 'data.output');
        const attr = event.attributes.find((a: any) => a.attribute === 'response');
        return attr.accessor as (ctx: any) => any;
    })();

    // status is derived from response.status; leaving it unset yields "success".
    const extractOutput = (response: any) => responseAccessor({ response });

    it('extracts plain text output', () => {
        const out = extractOutput({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Flight booked.' }] } }],
        });
        expect(out).toBe('Flight booked.');
    });

    it('serializes a single function-call response (was previously empty)', () => {
        const out = extractOutput({
            candidates: [{
                finishReason: 'STOP',
                content: { parts: [{ functionCall: { name: 'book_flight', args: { from: 'SFO', to: 'AYJ' } } }] },
            }],
        });
        expect(JSON.parse(out)).toEqual({
            function_call: { name: 'book_flight', args: { from: 'SFO', to: 'AYJ' } },
        });
    });

    it('serializes multiple function calls as an array', () => {
        const out = extractOutput({
            candidates: [{
                content: {
                    parts: [
                        { functionCall: { name: 'a', args: { x: 1 } } },
                        { functionCall: { name: 'b', args: { y: 2 } } },
                    ],
                },
            }],
        });
        expect(JSON.parse(out)).toEqual([
            { function_call: { name: 'a', args: { x: 1 } } },
            { function_call: { name: 'b', args: { y: 2 } } },
        ]);
    });

    it('prefers text when a response interleaves text and a function call', () => {
        const out = extractOutput({
            candidates: [{
                content: { parts: [{ text: 'Let me check.' }, { functionCall: { name: 'lookup' } }] },
            }],
        });
        expect(out).toBe('Let me check.');
    });

    it('returns empty string when there is neither text nor a function call', () => {
        const out = extractOutput({ candidates: [{ content: { parts: [] } }] });
        expect(out).toBe('');
    });

    it('no longer emits status or status_code attributes', () => {
        const event = (geminiInferenceConfig.events as any[]).find((e) => e.name === 'data.output');
        const attributeNames = event.attributes.map((a: any) => a.attribute);
        expect(attributeNames).not.toContain('status');
        expect(attributeNames).not.toContain('status_code');
        expect(attributeNames).toEqual(['response']);
    });
});

// =============================================================================
// metadata event — finish_reason / finish_type span attributes (the accessors
// that emit onto the span, incl. FUNCTION_CALL synthesis when Gemini says STOP)
// =============================================================================
describe('Gemini inference finish_reason / finish_type accessors', () => {
    const metadataAttr = (attribute: string) => {
        const event = (geminiInferenceConfig.events as any[]).find((e) => e.name === 'metadata');
        const attr = event.attributes.find((a: any) => a.attribute === attribute);
        return attr.accessor as (ctx: { response: any }) => any;
    };
    const finishReason = (response: any) => metadataAttr('finish_reason')({ response });
    const finishType = (response: any) => metadataAttr('finish_type')({ response });

    it('emits the raw finishReason for a plain text turn', () => {
        const response = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'done' }] } }] };
        expect(finishReason(response)).toBe('STOP');
        expect(finishType(response)).toBe(FinishType.SUCCESS);
    });

    it('synthesizes FUNCTION_CALL when the response carries a functionCall part (even with finishReason STOP)', () => {
        // Gemini reports STOP for tool calls; the accessor must rewrite to FUNCTION_CALL / tool_call.
        const response = {
            candidates: [{
                finishReason: 'STOP',
                content: { parts: [{ functionCall: { name: 'book_flight', args: {} } }] },
            }],
        };
        expect(finishReason(response)).toBe('FUNCTION_CALL');
        expect(finishType(response)).toBe(FinishType.TOOL_CALL);
    });

    it('maps MAX_TOKENS through to the truncated finish type', () => {
        const response = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'cut' }] } }] };
        expect(finishReason(response)).toBe('MAX_TOKENS');
        expect(finishType(response)).toBe(FinishType.TRUNCATED);
    });

    it('returns null finish_reason (and null finish_type) when none is present', () => {
        const response = { candidates: [{ content: { parts: [{ text: 'no reason' }] } }] };
        expect(finishReason(response)).toBeNull();
        expect(finishType(response)).toBeNull();
    });

    it('returns null for an empty / malformed response', () => {
        expect(finishReason({})).toBeNull();
        expect(finishType({})).toBeNull();
        expect(finishReason(null)).toBeNull();
        expect(finishType(null)).toBeNull();
    });
});

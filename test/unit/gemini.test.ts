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

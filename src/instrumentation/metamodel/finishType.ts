/**
 * This module provides common finish reason mappings and finish type enums
 * for different AI providers (OpenAI, Anthropic, Gemini, LangChain, LlamaIndex, Azure AI Inference).
 */

// Enum for standardized finish types across all AI providers
export enum FinishType {
    SUCCESS = "success",
    TRUNCATED = "truncated",
    CONTENT_FILTER = "content_filter",
    ERROR = "error",
    REFUSAL = "refusal",
    RATE_LIMITED = "rate_limited"
}

// OpenAI finish reason mapping
export const OPENAI_FINISH_REASON_MAPPING: Record<string, string> = {
    "stop": FinishType.SUCCESS,
    "tool_calls": FinishType.SUCCESS,
    "function_call": FinishType.SUCCESS,  // deprecated but still possible
    "length": FinishType.TRUNCATED,
    "content_filter": FinishType.CONTENT_FILTER
};

// Anthropic finish reason mapping
export const ANTHROPIC_FINISH_REASON_MAPPING: Record<string, string> = {
    "end_turn": FinishType.SUCCESS,         // Natural completion
    "max_tokens": FinishType.TRUNCATED,     // Hit max_tokens limit
    "stop_sequence": FinishType.SUCCESS,    // Hit user stop sequence
    "tool_use": FinishType.SUCCESS,         // Tool use triggered
    "pause_turn": FinishType.SUCCESS,       // Paused for tool or server action
    "refusal": FinishType.REFUSAL,          // Refused for safety/ethics
};

// Gemini finish reason mapping
export const GEMINI_FINISH_REASON_MAPPING: Record<string, string | null> = {
    "STOP": FinishType.SUCCESS,
    "MAX_TOKENS": FinishType.TRUNCATED,
    "SAFETY": FinishType.CONTENT_FILTER,
    "RECITATION": FinishType.CONTENT_FILTER,
    "OTHER": FinishType.ERROR,
    "FINISH_REASON_UNSPECIFIED": null
};

// LlamaIndex finish reason mapping
// LlamaIndex often wraps underlying provider responses, similar to LangChain
export const LLAMAINDEX_FINISH_REASON_MAPPING: Record<string, string> = {
    // Standard completion reasons
    "stop": FinishType.SUCCESS,
    "complete": FinishType.SUCCESS,
    "finished": FinishType.SUCCESS,
    "success": FinishType.SUCCESS,
    
    // Token limits
    "length": FinishType.TRUNCATED,
    "max_tokens": FinishType.TRUNCATED,
    "token_limit": FinishType.TRUNCATED,
    "truncated": FinishType.TRUNCATED,
    
    // Tool/function calling
    "tool_calls": FinishType.SUCCESS,
    "function_call": FinishType.SUCCESS,
    "agent_finish": FinishType.SUCCESS,
    
    // Content filtering and safety
    "content_filter": FinishType.CONTENT_FILTER,
    "safety": FinishType.CONTENT_FILTER,
    "filtered": FinishType.CONTENT_FILTER,
    
    // Errors
    "error": FinishType.ERROR,
    "failed": FinishType.ERROR,
    "exception": FinishType.ERROR,
    
    // Provider-specific reasons that might pass through LlamaIndex
    // OpenAI reasons
    "end_turn": FinishType.SUCCESS,  // Anthropic
    "stop_sequence": FinishType.SUCCESS,  // Anthropic
    "STOP": FinishType.SUCCESS,  // Gemini
    "SAFETY": FinishType.CONTENT_FILTER,  // Gemini
    "RECITATION": FinishType.CONTENT_FILTER,  // Gemini
    "OTHER": FinishType.ERROR,  // Gemini
};

// Azure AI Inference finish reason mapping
export const AZURE_AI_INFERENCE_FINISH_REASON_MAPPING: Record<string, string> = {
    // Standard completion reasons
    "stop": FinishType.SUCCESS,
    "completed": FinishType.SUCCESS,
    "finished": FinishType.SUCCESS,
    
    // Token limits
    "length": FinishType.TRUNCATED,
    "max_tokens": FinishType.TRUNCATED,
    "token_limit": FinishType.TRUNCATED,
    "max_completion_tokens": FinishType.TRUNCATED,
    
    // Tool/function calling
    "tool_calls": FinishType.SUCCESS,
    "function_call": FinishType.SUCCESS,
    
    // Content filtering and safety
    "content_filter": FinishType.CONTENT_FILTER,
    "content_filtered": FinishType.CONTENT_FILTER,
    "safety": FinishType.CONTENT_FILTER,
    "responsible_ai_policy": FinishType.CONTENT_FILTER,
    
    // Errors
    "error": FinishType.ERROR,
    "failed": FinishType.ERROR,
    "exception": FinishType.ERROR,
    "timeout": FinishType.ERROR,
    
    // Azure-specific reasons
    "model_error": FinishType.ERROR,
    "service_unavailable": FinishType.ERROR,
    "rate_limit": FinishType.ERROR,
};

// AWS Bedrock finish reason mapping
// Based on AWS Bedrock Converse API and model-specific APIs
export const BEDROCK_FINISH_REASON_MAPPING: Record<string, string> = {
    // Standard completion reasons
    "end_turn": FinishType.SUCCESS,           // Natural completion
    "stop": FinishType.SUCCESS,               // Hit stop sequence
    "stop_sequence": FinishType.SUCCESS,      // Stop sequence triggered
    "completed": FinishType.SUCCESS,          // Completion finished successfully
    
    // Token limits
    "max_tokens": FinishType.TRUNCATED,       // Hit max_tokens limit
    "length": FinishType.TRUNCATED,           // Token length limit
    "max_length": FinishType.TRUNCATED,       // Maximum length reached
    "token_limit": FinishType.TRUNCATED,      // Token limit reached
    
    // Tool/function calling
    "tool_use": FinishType.SUCCESS,           // Tool use triggered
    "function_call": FinishType.SUCCESS,      // Function call triggered
    
    // Content filtering and safety
    "content_filter": FinishType.CONTENT_FILTER,    // Content filtered
    "content_filtered": FinishType.CONTENT_FILTER,  // Content was filtered
    "safety": FinishType.CONTENT_FILTER,            // Safety filter triggered
    "guardrails": FinishType.CONTENT_FILTER,        // Bedrock guardrails triggered
    "blocked": FinishType.CONTENT_FILTER,           // Request blocked
    
    // Errors
    "error": FinishType.ERROR,                // General error
    "failed": FinishType.ERROR,               // Request failed
    "exception": FinishType.ERROR,            // Exception occurred
    "timeout": FinishType.ERROR,              // Request timeout
    "model_error": FinishType.ERROR,          // Model-specific error
    "service_unavailable": FinishType.ERROR,  // Service unavailable
    "throttled": FinishType.ERROR,            // Request throttled
    "rate_limit": FinishType.ERROR,           // Rate limit exceeded
    "validation_error": FinishType.ERROR,     // Validation error
    
    // Model-specific reasons (various Bedrock models)
    // AI21 models via Bedrock
    "endoftext": FinishType.SUCCESS,          // AI21 end of text
    
    // Cohere models via Bedrock
    "COMPLETE": FinishType.SUCCESS,           // Cohere completion
    "MAX_TOKENS": FinishType.TRUNCATED,       // Cohere max tokens
    "ERROR": FinishType.ERROR,                // Cohere error
    
    // Amazon Titan models via Bedrock
    "FINISH": FinishType.SUCCESS,             // Titan finish
    "LENGTH": FinishType.TRUNCATED,           // Titan length limit
    "CONTENT_FILTERED": FinishType.CONTENT_FILTER,  // Titan content filter
};

// LangChain finish reason mapping
// LangChain often wraps underlying provider responses, so we include common finish reasons
// that might appear in LangChain response objects
export const LANGCHAIN_FINISH_REASON_MAPPING: Record<string, string> = {
    // Standard completion reasons
    "stop": FinishType.SUCCESS,
    "complete": FinishType.SUCCESS,
    "finished": FinishType.SUCCESS,
    
    // Token limits
    "length": FinishType.TRUNCATED,
    "max_tokens": FinishType.TRUNCATED,
    "token_limit": FinishType.TRUNCATED,
    
    // Tool/function calling
    "tool_calls": FinishType.SUCCESS,
    "function_call": FinishType.SUCCESS,
    
    // Content filtering and safety
    "content_filter": FinishType.CONTENT_FILTER,
    "safety": FinishType.CONTENT_FILTER,
    "filtered": FinishType.CONTENT_FILTER,
    
    // Errors
    "error": FinishType.ERROR,
    "failed": FinishType.ERROR,
    "exception": FinishType.ERROR,
    
    // Provider-specific reasons that might pass through LangChain
    // Anthropic reasons
    "end_turn": FinishType.SUCCESS,
    "stop_sequence": FinishType.SUCCESS,
    
    // Gemini reasons
    "STOP": FinishType.SUCCESS,
    "SAFETY": FinishType.CONTENT_FILTER,
    "RECITATION": FinishType.CONTENT_FILTER,
    "OTHER": FinishType.ERROR,
};

export const TEAMSAI_FINISH_REASON_MAPPING: Record<string, string> = {
    "success": FinishType.SUCCESS,
    "error": FinishType.ERROR,
    "too_long": FinishType.TRUNCATED,
    "rate_limited": FinishType.RATE_LIMITED,
    "invalid_response": FinishType.ERROR,
};

// Haystack finish reason mapping
export const HAYSTACK_FINISH_REASON_MAPPING: Record<string, string> = {
    // Standard completion reasons
    "stop": FinishType.SUCCESS,
    "complete": FinishType.SUCCESS,
    "finished": FinishType.SUCCESS,

    // Token limits
    "length": FinishType.TRUNCATED,
    "max_tokens": FinishType.TRUNCATED,
    "token_limit": FinishType.TRUNCATED,

    // Tool/function calling
    "tool_calls": FinishType.SUCCESS,
    "function_call": FinishType.SUCCESS,

    // Content filtering and safety
    "content_filter": FinishType.CONTENT_FILTER,
    "safety": FinishType.CONTENT_FILTER,
    "filtered": FinishType.CONTENT_FILTER,

    // Errors
    "error": FinishType.ERROR,
    "failed": FinishType.ERROR,
    "exception": FinishType.ERROR,

    // Provider-specific reasons that might pass through Haystack
    // Anthropic reasons
    "end_turn": FinishType.SUCCESS,
    "stop_sequence": FinishType.SUCCESS,

    // Gemini reasons
    "STOP": FinishType.SUCCESS,
    "SAFETY": FinishType.CONTENT_FILTER,
    "RECITATION": FinishType.CONTENT_FILTER,
    "OTHER": FinishType.ERROR,
};

// Mapping functions

export function mapOpenaiFinishReasonToFinishType(finishReason: string | null): string | null {
    /**
     * Map OpenAI finish_reason to standardized finish_type.
     */
    if (!finishReason) {
        return null;
    }
    return OPENAI_FINISH_REASON_MAPPING[finishReason] || null;
}

export function mapAnthropicFinishReasonToFinishType(finishReason: string | null): string | null {
    /**
     * Map Anthropic stop_reason to standardized finish_type.
     */
    if (!finishReason) {
        return null;
    }
    return ANTHROPIC_FINISH_REASON_MAPPING[finishReason] || null;
}

export function mapGeminiFinishReasonToFinishType(finishReason: string | null): string | null {
    /**
     * Map Gemini finish_reason to standardized finish_type.
     */
    if (!finishReason) {
        return null;
    }
    return GEMINI_FINISH_REASON_MAPPING[finishReason] || null;
}

export function mapLangchainFinishReasonToFinishType(finishReason: string | null): string | null {
    /**
     * Map LangChain finish_reason to standardized finish_type.
     */
    if (!finishReason) {
        return null;
    }
    
    // Convert to lowercase for case-insensitive matching
    const finishReasonLower = typeof finishReason === 'string' ? finishReason.toLowerCase() : String(finishReason).toLowerCase();
    
    // Try direct mapping first
    if (finishReason in LANGCHAIN_FINISH_REASON_MAPPING) {
        return LANGCHAIN_FINISH_REASON_MAPPING[finishReason];
    }
    
    // Try lowercase mapping
    if (finishReasonLower in LANGCHAIN_FINISH_REASON_MAPPING) {
        return LANGCHAIN_FINISH_REASON_MAPPING[finishReasonLower];
    }
    
    // If no direct mapping, try to infer from common patterns
    if (['stop', 'complete', 'success', 'done'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.SUCCESS;
    } else if (['length', 'token', 'limit', 'truncat'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.TRUNCATED;
    } else if (['filter', 'safety', 'block'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.CONTENT_FILTER;
    } else if (['error', 'fail', 'exception'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.ERROR;
    }
    
    return null;
}

export function mapLlamaindexFinishReasonToFinishType(finishReason: string | null): string | null {
    /**
     * Map LlamaIndex finish_reason to standardized finish_type.
     */
    if (!finishReason) {
        return null;
    }
    
    // Convert to lowercase for case-insensitive matching
    const finishReasonLower = typeof finishReason === 'string' ? finishReason.toLowerCase() : String(finishReason).toLowerCase();
    
    // Try direct mapping first
    if (finishReason in LLAMAINDEX_FINISH_REASON_MAPPING) {
        return LLAMAINDEX_FINISH_REASON_MAPPING[finishReason];
    }
    
    // Try lowercase mapping
    if (finishReasonLower in LLAMAINDEX_FINISH_REASON_MAPPING) {
        return LLAMAINDEX_FINISH_REASON_MAPPING[finishReasonLower];
    }
    
    // If no direct mapping, try to infer from common patterns
    if (['stop', 'complete', 'success', 'done', 'finish'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.SUCCESS;
    } else if (['length', 'token', 'limit', 'truncat'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.TRUNCATED;
    } else if (['filter', 'safety', 'block'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.CONTENT_FILTER;
    } else if (['error', 'fail', 'exception'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.ERROR;
    }
    
    return null;
}

export function mapAzureAiInferenceFinishReasonToFinishType(finishReason: string | null): string | null {
    /**
     * Map Azure AI Inference finish_reason to standardized finish_type.
     */
    if (!finishReason) {
        return null;
    }
    
    // Convert to lowercase for case-insensitive matching
    const finishReasonLower = typeof finishReason === 'string' ? finishReason.toLowerCase() : String(finishReason).toLowerCase();
    
    // Try direct mapping first
    if (finishReason in AZURE_AI_INFERENCE_FINISH_REASON_MAPPING) {
        return AZURE_AI_INFERENCE_FINISH_REASON_MAPPING[finishReason];
    }
    
    // Try lowercase mapping
    if (finishReasonLower in AZURE_AI_INFERENCE_FINISH_REASON_MAPPING) {
        return AZURE_AI_INFERENCE_FINISH_REASON_MAPPING[finishReasonLower];
    }
    
    // If no direct mapping, try to infer from common patterns
    if (['stop', 'complete', 'success', 'done', 'finish'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.SUCCESS;
    } else if (['length', 'token', 'limit', 'truncat'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.TRUNCATED;
    } else if (['filter', 'safety', 'block', 'responsible_ai', 'content_filter'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.CONTENT_FILTER;
    } else if (['error', 'fail', 'exception', 'timeout', 'unavailable', 'rate_limit'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.ERROR;
    }
    
    return null;
}

export function mapBedrockFinishReasonToFinishType(finishReason: string | null): string | null {
    /**
     * Map AWS Bedrock finish_reason/stopReason to standardized finish_type.
     */
    if (!finishReason) {
        return null;
    }
    
    // Convert to lowercase for case-insensitive matching
    const finishReasonLower = typeof finishReason === 'string' ? finishReason.toLowerCase() : String(finishReason).toLowerCase();
    
    // Try direct mapping first
    if (finishReason in BEDROCK_FINISH_REASON_MAPPING) {
        return BEDROCK_FINISH_REASON_MAPPING[finishReason];
    }
    
    // Try lowercase mapping
    if (finishReasonLower in BEDROCK_FINISH_REASON_MAPPING) {
        return BEDROCK_FINISH_REASON_MAPPING[finishReasonLower];
    }
    
    // If no direct mapping, try to infer from common patterns
    if (['stop', 'complete', 'success', 'done', 'finish', 'end_turn', 'endoftext'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.SUCCESS;
    } else if (['length', 'token', 'limit', 'truncat', 'max_tokens'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.TRUNCATED;
    } else if (['filter', 'safety', 'block', 'guardrails', 'content_filter'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.CONTENT_FILTER;
    } else if (['error', 'fail', 'exception', 'timeout', 'unavailable', 'rate_limit', 'throttled', 'validation'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.ERROR;
    }
    
    return null;
}

export function mapHaystackFinishReasonToFinishType(finishReason: string | null): string | null {
    /**
     * Map Haystack finish_reason to standardized finish_type.
     */
    if (!finishReason) {
        return null;
    }

    // Convert to lowercase for case-insensitive matching
    const finishReasonLower = typeof finishReason === 'string' ? finishReason.toLowerCase() : String(finishReason).toLowerCase();

    // Try direct mapping first
    if (finishReason in HAYSTACK_FINISH_REASON_MAPPING) {
        return HAYSTACK_FINISH_REASON_MAPPING[finishReason];
    }

    // Try lowercase mapping
    if (finishReasonLower in HAYSTACK_FINISH_REASON_MAPPING) {
        return HAYSTACK_FINISH_REASON_MAPPING[finishReasonLower];
    }

    // If no direct mapping, try to infer from common patterns
    if (['stop', 'complete', 'success', 'done'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.SUCCESS;
    } else if (['length', 'token', 'limit', 'truncat'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.TRUNCATED;
    } else if (['filter', 'safety', 'block'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.CONTENT_FILTER;
    } else if (['error', 'fail', 'exception'].some(keyword => finishReasonLower.includes(keyword))) {
        return FinishType.ERROR;
    }

    return null;
}

export function mapTeamsaiFinishReasonToFinishType(finishReason: string | null): string | null {
    /**
     * Map TeamsAI finish_reason to standardized finish_type.
     */
    if (!finishReason) {
        return null;
    }

    // Convert to lowercase for case-insensitive matching
    const finishReasonLower = typeof finishReason === 'string' ? finishReason.toLowerCase() : String(finishReason).toLowerCase();

    // Try direct mapping first
    if (finishReason in TEAMSAI_FINISH_REASON_MAPPING) {
        return TEAMSAI_FINISH_REASON_MAPPING[finishReason];
    }

    // Try lowercase mapping
    if (finishReasonLower in TEAMSAI_FINISH_REASON_MAPPING) {
        return TEAMSAI_FINISH_REASON_MAPPING[finishReasonLower];
    }

    return null;
}

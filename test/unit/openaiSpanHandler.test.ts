import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { context, SpanStatusCode } from '@opentelemetry/api';
import { config as openaiMethods } from '../../src/instrumentation/metamodel/openai/methods';

function createMockSpan() {
    const attributes: Record<string, any> = {};
    const events: Array<{ name: string; attributes: Record<string, any> }> = [];
    return {
        attributes,
        events,
        // child span, so processSpan starts entity indexing at 1
        parentSpanContext: { spanId: 'parent-span-id' },
        setAttribute: vi.fn((key: string, value: any) => {
            attributes[key] = value;
        }),
        addEvent: vi.fn((name: string, eventAttributes: Record<string, any>) => {
            events.push({ name, attributes: eventAttributes });
        }),
        setStatus: vi.fn(),
        updateName: vi.fn(),
        spanContext: vi.fn().mockReturnValue({ traceId: 'trace-id' }),
        status: { code: SpanStatusCode.UNSET }
    };
}

function setActiveWorkflowType(workflowType: string | undefined) {
    vi.spyOn(context, 'active').mockReturnValue({
        getValue: vi.fn().mockReturnValue(workflowType)
    } as any);
}

const embeddingsElement: any = openaiMethods.find(
    (element: any) => element.spanName === 'openai_embeddings'
);
const chatElement: any = openaiMethods.find(
    (element: any) => element.spanName === 'openai_chat'
);
const responsesElement: any = openaiMethods.find(
    (element: any) => element.spanName === 'openai_responses'
);

const embeddingsInstance = { _client: { baseURL: 'https://api.openai.com/v1' } };
const embeddingsArgs = [
    { model: 'text-embedding-ada-002', input: ['whats coffee'] }
] as unknown as IArguments;
const embeddingsResponse = { data: [{ embedding: [0.1, 0.2, 0.3] }] };

function processEmbeddingsSpan() {
    const span = createMockSpan();
    embeddingsElement.spanHandler.processSpan({
        span,
        instance: embeddingsInstance,
        args: embeddingsArgs,
        returnValue: embeddingsResponse,
        outputProcessor: embeddingsElement.output_processor,
        wrappedPackage: 'openai'
    });
    return span;
}

describe('OpenAISpanHandler', () => {
    beforeEach(() => {
        setActiveWorkflowType(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('embeddings span', () => {
        it('keeps retrieval semantics when a framework workflow (LangChain) is active', () => {
            setActiveWorkflowType('workflow.langchain');

            const span = processEmbeddingsSpan();

            expect(span.attributes['span.type']).toBe('retrieval');
            expect(span.attributes['entity.1.name']).toBe('text-embedding-ada-002');
            expect(span.attributes['entity.1.type']).toBe(
                'model.embedding.text-embedding-ada-002'
            );
            expect(span.attributes['entity.count']).toBe(1);

            const inputEvent = span.events.find((event) => event.name === 'data.input');
            expect(inputEvent?.attributes.input).toEqual(['whats coffee']);

            const outputEvent = span.events.find((event) => event.name === 'data.output');
            expect(outputEvent?.attributes.response).toBe('0.1,0.2,0.3...');
            expect(outputEvent?.attributes.status).toBe('success');
        });

        it('keeps retrieval semantics for a direct OpenAI call', () => {
            const span = processEmbeddingsSpan();

            expect(span.attributes['span.type']).toBe('retrieval');
            expect(span.attributes['entity.1.type']).toBe(
                'model.embedding.text-embedding-ada-002'
            );
        });
    });

    describe('chat span', () => {
        function processChatSpan() {
            const span = createMockSpan();
            chatElement.spanHandler.processSpan({
                span,
                instance: { _client: { baseURL: 'https://api.openai.com/v1' } },
                args: [
                    { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hi' }] }
                ] as unknown as IArguments,
                returnValue: {
                    choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
                },
                outputProcessor: chatElement.output_processor,
                wrappedPackage: 'openai'
            });
            return span;
        }

        // Guards the deliberate behaviour from #111/#113: the framework's own
        // langchain.chat span carries the prompt/response/tokens, so the
        // model-API span defers instead of duplicating them.
        it('defers to the framework inference span when a framework workflow is active', () => {
            setActiveWorkflowType('workflow.langchain');

            const span = processChatSpan();

            expect(span.attributes['span.type']).toBe('inference.modelapi');
            expect(span.attributes['entity.1.type']).toBeUndefined();
            expect(span.events).toHaveLength(0);
        });

        it('is a full inference span for a direct OpenAI call', () => {
            const span = processChatSpan();

            expect(span.attributes['span.type']).toBe('inference');
            expect(span.attributes['entity.1.type']).toBe('inference.openai');
            expect(span.attributes['entity.2.type']).toBe('model.llm.gpt-3.5-turbo');
            expect(span.attributes['entity.count']).toBe(2);
            expect(span.events.map((event) => event.name)).toEqual([
                'data.input',
                'data.output',
                'metadata'
            ]);
        });
    });

    // A tool-calling turn spends its tokens on the call, not on text, so reading
    // only text records an empty output. Shape matches the Mastra metamodel.
    describe('responses span with tool calls', () => {
        function processResponsesSpan(response: any) {
            const span = createMockSpan();
            responsesElement.spanHandler.processSpan({
                span,
                instance: { _client: { baseURL: 'https://api.openai.com/v1' } },
                args: [{ model: 'gpt-4o', input: 'weather in SFO?' }] as unknown as IArguments,
                returnValue: response,
                outputProcessor: responsesElement.output_processor,
                wrappedPackage: 'openai'
            });
            return span;
        }

        function responseOf(span: any) {
            const event = span.events.find((e: any) => e.name === 'data.output');
            return event?.attributes.response;
        }

        it('records the tool call the model emitted', () => {
            const span = processResponsesSpan({
                model: 'gpt-4o',
                output: [
                    {
                        type: 'function_call',
                        call_id: 'call_1',
                        name: 'get_weather',
                        arguments: '{"city":"San Francisco"}'
                    }
                ],
                output_text: '',
                usage: { input_tokens: 88, output_tokens: 19, total_tokens: 107 }
            });

            // Parsed, not string-matched, so escaping cannot skew it.
            // `arguments` stays the raw JSON string the API returns.
            const [payload] = responseOf(span) as string[];
            expect(JSON.parse(payload)).toEqual({
                name: 'get_weather',
                arguments: '{"city":"San Francisco"}'
            });
        });

        // Mapping status alone always yields "stop": a tool-calling turn is
        // "completed" too. The signal lives in output[].
        it('reports finish_reason tool_calls and subtype tool_call for a tool-calling turn', () => {
            const span = processResponsesSpan({
                model: 'gpt-4o',
                status: 'completed',
                output: [
                    {
                        type: 'function_call',
                        call_id: 'call_1',
                        name: 'get_weather',
                        arguments: '{"city":"San Francisco"}'
                    }
                ],
                output_text: '',
                usage: { input_tokens: 88, output_tokens: 19, total_tokens: 107 }
            });

            const md = span.events.find((e: any) => e.name === 'metadata');
            expect(md?.attributes.finish_reason).toBe('tool_calls');
            // A tool call is still a successful turn, as in chat.completions.
            expect(md?.attributes.finish_type).toBe('success');
            expect(md?.attributes.inference_sub_type).toBe('tool_call');
        });

        it('reports finish_reason stop and subtype turn_end for a text turn', () => {
            const span = processResponsesSpan({
                model: 'gpt-4o',
                status: 'completed',
                output: [
                    {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'San Francisco is sunny.' }]
                    }
                ],
                output_text: 'San Francisco is sunny.',
                usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
            });

            const md = span.events.find((e: any) => e.name === 'metadata');
            expect(md?.attributes.finish_reason).toBe('stop');
            expect(md?.attributes.inference_sub_type).toBe('turn_end');
        });

        it('records text and a tool call together when the model emits both', () => {
            const span = processResponsesSpan({
                model: 'gpt-4o',
                output: [
                    {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'Let me check.' }]
                    },
                    {
                        type: 'function_call',
                        call_id: 'call_1',
                        name: 'get_weather',
                        arguments: '{"city":"SFO"}'
                    }
                ],
                output_text: 'Let me check.',
                usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
            });

            const response = String(responseOf(span));
            expect(response).toContain('Let me check.');
            expect(response).toContain('get_weather');
        });

        it('still records a plain text turn unchanged', () => {
            const span = processResponsesSpan({
                model: 'gpt-4o',
                output: [
                    {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'San Francisco is sunny.' }]
                    }
                ],
                output_text: 'San Francisco is sunny.',
                usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
            });

            expect(responseOf(span)).toEqual(['San Francisco is sunny.']);
        });

        it('records a streamed turn, which carries only accumulated text', () => {
            const span = processResponsesSpan({
                model: 'gpt-4o',
                output_text: 'streamed answer',
                usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
            });

            expect(responseOf(span)).toEqual(['streamed answer']);
        });
    });

    describe('chat span with tool calls', () => {
        it('keeps the finish_reason OpenAI itself reports', () => {
            const span = createMockSpan();
            chatElement.spanHandler.processSpan({
                span,
                instance: { _client: { baseURL: 'https://api.openai.com/v1' } },
                args: [{ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }] as unknown as IArguments,
                returnValue: {
                    choices: [{
                        message: {
                            content: null,
                            tool_calls: [{ id: 'c1', type: 'function',
                                function: { name: 'get_weather', arguments: '{}' } }]
                        },
                        finish_reason: 'tool_calls'
                    }],
                    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
                },
                outputProcessor: chatElement.output_processor,
                wrappedPackage: 'openai'
            });

            const md = span.events.find((e: any) => e.name === 'metadata');
            expect(md?.attributes.finish_reason).toBe('tool_calls');
            expect(md?.attributes.inference_sub_type).toBe('tool_call');
        });

        it('records the tool call from a chat.completions turn', () => {
            const span = createMockSpan();
            chatElement.spanHandler.processSpan({
                span,
                instance: { _client: { baseURL: 'https://api.openai.com/v1' } },
                args: [{ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }] as unknown as IArguments,
                returnValue: {
                    choices: [{
                        message: {
                            content: null,
                            tool_calls: [{
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'get_weather', arguments: '{"city":"SFO"}' }
                            }]
                        },
                        finish_reason: 'tool_calls'
                    }],
                    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
                },
                outputProcessor: chatElement.output_processor,
                wrappedPackage: 'openai'
            });

            const event = span.events.find((e: any) => e.name === 'data.output');
            expect(String(event?.attributes.response)).toContain('get_weather');
            expect(String(event?.attributes.response)).toContain('SFO');
        });
    });
});

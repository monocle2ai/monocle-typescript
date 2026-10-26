import { describe, it, expect, beforeEach } from 'vitest';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    ReadableSpan,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { ExportResultCode } from '@opentelemetry/core';
import { getGenaiAttributes } from '../../src/exporters/otlp/genaiSemconv';
import { GenaiSemconvSpanExporter } from '../../src/exporters/otlp/GenaiSemconvSpanExporter';

const memory = new InMemorySpanExporter();
const tracer = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(memory)],
}).getTracer('test');

function finishedSpan(attributes: Record<string, any>, metadata?: Record<string, any>): ReadableSpan {
    const span = tracer.startSpan('test');
    span.setAttributes(attributes);
    if (metadata) {
        span.addEvent('metadata', metadata);
    }
    span.end();
    const spans = memory.getFinishedSpans();
    return spans[spans.length - 1];
}

describe('getGenaiAttributes', () => {
    beforeEach(() => memory.reset());

    it('maps an inference span to chat with model, provider and tokens', () => {
        const added = getGenaiAttributes(
            finishedSpan(
                {
                    'span.type': 'inference',
                    'entity.1.provider_name': 'openrouter.ai',
                    'entity.1.type': 'inference.openai',
                    'entity.2.name': 'openai/gpt-4.1-mini',
                    'entity.2.type': 'model.llm.openai/gpt-4.1-mini',
                    'workflow.name': 'trip_concierge',
                },
                { prompt_tokens: 12, completion_tokens: 7 }
            )
        );

        expect(added).toEqual({
            'gen_ai.operation.name': 'chat',
            'gen_ai.workflow.name': 'trip_concierge',
            'gen_ai.provider.name': 'openrouter.ai',
            'gen_ai.request.model': 'openai/gpt-4.1-mini',
            'gen_ai.usage.input_tokens': 12,
            'gen_ai.usage.output_tokens': 7,
        });
    });

    it('reads input_tokens/output_tokens when prompt/completion are absent', () => {
        const added = getGenaiAttributes(
            finishedSpan({ 'span.type': 'inference.framework' }, { input_tokens: 3, output_tokens: 4 })
        );

        expect(added['gen_ai.usage.input_tokens']).toBe(3);
        expect(added['gen_ai.usage.output_tokens']).toBe(4);
    });

    it('maps a tool span to execute_tool with the tool name', () => {
        const added = getGenaiAttributes(
            finishedSpan({
                'span.type': 'agentic.tool.invocation',
                'entity.1.name': 'get_weather',
                'entity.1.type': 'tool.function',
            })
        );

        expect(added['gen_ai.operation.name']).toBe('execute_tool');
        expect(added['gen_ai.tool.name']).toBe('get_weather');
    });

    it('maps an agent span to invoke_agent with the agent name', () => {
        const added = getGenaiAttributes(
            finishedSpan({
                'span.type': 'agentic.invocation',
                'entity.1.name': 'planner',
                'entity.1.type': 'agent.openai_agents',
            })
        );

        expect(added['gen_ai.operation.name']).toBe('invoke_agent');
        expect(added['gen_ai.agent.name']).toBe('planner');
    });

    it('maps an embedding span to embeddings with the embedding model', () => {
        const added = getGenaiAttributes(
            finishedSpan({
                'span.type': 'embedding.modelapi',
                'entity.23.name': 'text-embedding-3-large',
                'entity.23.type': 'model.embedding.text-embedding-3-large',
            })
        );

        expect(added['gen_ai.operation.name']).toBe('embeddings');
        expect(added['gen_ai.request.model']).toBe('text-embedding-3-large');
    });

    it('maps a retrieval span to retrieval', () => {
        const added = getGenaiAttributes(finishedSpan({ 'span.type': 'retrieval' }));

        expect(added['gen_ai.operation.name']).toBe('retrieval');
    });

    it('does not return gen_ai attributes that are already set', () => {
        const added = getGenaiAttributes(
            finishedSpan({ 'span.type': 'inference', 'gen_ai.operation.name': 'custom_operation' })
        );

        expect(added).not.toHaveProperty('gen_ai.operation.name');
    });

    it('returns nothing for non-AI spans', () => {
        expect(getGenaiAttributes(finishedSpan({ 'span.type': 'http.send' }))).toEqual({});
    });
});

describe('GenaiSemconvSpanExporter', () => {
    beforeEach(() => memory.reset());

    function capture() {
        const exported: ReadableSpan[][] = [];
        const delegate = {
            export: (spans: ReadableSpan[], done: (r: any) => void) => {
                exported.push(spans);
                done({ code: ExportResultCode.SUCCESS });
            },
            shutdown: () => Promise.resolve(),
        };
        return { exporter: new GenaiSemconvSpanExporter(delegate), exported };
    }

    it('passes enriched copies to the delegate and keeps the originals unchanged', () => {
        const { exporter, exported } = capture();
        const ai = finishedSpan({ 'span.type': 'agentic.tool.invocation', 'entity.1.name': 'get_weather', 'entity.1.type': 'tool.function' });
        const http = finishedSpan({ 'span.type': 'http.process' });
        const before = { ...ai.attributes };

        exporter.export([ai, http], () => {});

        const [sentAi, sentHttp] = exported[0];
        expect(sentAi.attributes['gen_ai.tool.name']).toBe('get_weather');
        expect(sentAi.spanContext()).toEqual(ai.spanContext());
        expect(sentAi.duration).toEqual(ai.duration);
        expect(sentHttp).toBe(http);
        expect(ai.attributes).toEqual(before);
    });

    it('falls back to the original span when mapping throws', () => {
        const { exporter, exported } = capture();
        const broken = { attributes: null, get events(): any { throw new Error('boom'); } } as any;
        broken.attributes = { 'span.type': 'inference' };

        exporter.export([broken], () => {});

        expect(exported[0][0]).toBe(broken);
    });
});

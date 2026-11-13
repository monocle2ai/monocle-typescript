import { describe, it, expect } from 'vitest';
import { config } from '../../src/instrumentation/metamodel/typesafe/entities/inference';
import { config as methods } from '../../src/instrumentation/metamodel/typesafe/methods';
import { NonFrameworkSpanHandler } from '../../src/instrumentation/common/spanHandler';

const response = {
  model: 'jev-1.14.0',
  answers: { refund: { type: 'noul', noul: 0.78 } },
  usage: { input_tokens: 401, output_tokens: 69 },
};
const request = {
  model: 'jev-latest',
  state: { ticket: 'charged twice' },
  questions: { refund: { type: 'noul', instructions: 'Refund?' } },
};
const instance = { baseURL: 'https://api.typesafe.ai', defaultModel: 'jev-latest' };

// Runs the real handler against a fake span and returns what it recorded.
function run(returnValue: any, exception?: any) {
  const attributes: Record<string, any> = {};
  const events: Record<string, any> = {};
  const span: any = {
    setAttribute: (k: string, v: any) => { attributes[k] = v; },
    addEvent: (name: string, attrs: any) => { events[name] = attrs; },
    setStatus: () => {},
    parentSpanContext: { spanId: 'parent' },
    status: { code: 0 },
  };
  new NonFrameworkSpanHandler().processSpan({
    span, instance, args: [request] as any, returnValue,
    outputProcessor: [config], wrappedPackage: '@typesafe-ai/sdk', exception,
  });
  return { attributes, events };
}

describe('typesafe systemOne metamodel', () => {
  it('wraps TypeSafeClient.systemOne', () => {
    expect(methods[0]).toMatchObject({ package: '@typesafe-ai/sdk', object: 'TypeSafeClient', method: 'systemOne' });
  });

  it('sets inference attributes from the response', () => {
    const { attributes } = run(response);
    expect(attributes['span.type']).toBe('inference');
    expect(attributes['entity.1.type']).toBe('inference.typesafe');
    expect(attributes['entity.1.provider_name']).toBe('typesafe');
    expect(attributes['entity.1.inference_endpoint']).toBe('https://api.typesafe.ai/v1/systemone');
    expect(attributes['entity.2.name']).toBe('jev-1.14.0');
    expect(attributes['entity.2.type']).toBe('model.decision.jev-1.14.0');
    expect(attributes['entity.2.model_type']).toBe('decision');
  });

  it('falls back to the requested model without a response', () => {
    const { attributes } = run(undefined);
    expect(attributes['entity.2.name']).toBe('jev-latest');
    expect(attributes['entity.2.model_type']).toBe('decision');
  });

  it('records state, questions, answers and usage', () => {
    const { events } = run(response);
    const input = events['data.input'].input;
    expect(input).toHaveLength(2);
    expect(JSON.parse(input[0])).toEqual({ state: request.state });
    expect(JSON.parse(input[1])).toEqual({ refund: request.questions.refund });
    expect(JSON.parse(events['data.output'].response)).toEqual(response.answers);
    expect(events['data.output'].status).toBe('success');
    expect(events['metadata']).toMatchObject({ prompt_tokens: 401, completion_tokens: 69, total_tokens: 470 });
  });

  it('records one input entry per question after the state', () => {
    const questions = { a: { type: 'noul', instructions: 'A?' }, b: { type: 'choice', instructions: 'B?', criteria: { x: null } } };
    const input = config.events[0].attributes[0].accessor({ args: [{ state: 's', questions }] });
    expect(input.map((e: string) => JSON.parse(e))).toEqual([{ state: 's' }, { a: questions.a }, { b: questions.b }]);
  });

  it('marks a normal return as success', () => {
    const { events } = run(response);
    expect(events['metadata']).toMatchObject({ finish_reason: 'success', finish_type: 'success' });
  });

  it('keeps the SDK serialization for images in state', () => {
    // The SDK's Image serializes itself via toJSON; the span must not alter it.
    const photo = { toJSON: () => '<image:abc123>' };
    const attrs = config.events[0].attributes[0].accessor({ args: [{ state: photo, questions: {} }] });
    expect(attrs[0]).toBe('{"state":"<image:abc123>"}');
  });

  it('records the error message on exception', () => {
    const { events } = run(undefined, new Error('rate limited'));
    expect(events['data.output'].response).toBe('rate limited');
    expect(events['data.output'].status).toBe('error');
    expect(events['metadata']).toEqual({ finish_reason: 'error', finish_type: 'error' });
  });
});

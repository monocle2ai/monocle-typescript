import { describe, it, expect } from 'vitest';
import { config } from '../../src/instrumentation/metamodel/typesafe/entities/inference';
import { config as methods } from '../../src/instrumentation/metamodel/typesafe/methods';
import { NonFrameworkSpanHandler } from '../../src/instrumentation/common/spanHandler';

const response = {
  model: 'typesafe/jev-1.14-20261014',
  answers: { refund: { type: 'noul', noul: 0.78 } },
  usage: { input_tokens: 401, output_tokens: 69, cost: 0.000016842 },
  provider: 'TypeSafe',
};
const request = {
  model: 'jev-latest',
  state: { ticket: 'charged twice' },
  questions: { refund: { type: 'noul', instructions: 'Refund?' } },
};
const instance = { baseURL: 'https://openrouter.ai/api', defaultModel: 'jev-latest' };

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
    expect(attributes['entity.1.inference_endpoint']).toBe('https://openrouter.ai/api/v1/systemone');
    expect(attributes['entity.2.name']).toBe('typesafe/jev-1.14-20261014');
    expect(attributes['entity.2.type']).toBe('model.llm.typesafe/jev-1.14-20261014');
  });

  it('falls back to the requested model without a response', () => {
    const { attributes } = run(undefined);
    expect(attributes['entity.2.name']).toBe('jev-latest');
  });

  it('records state, questions, answers and usage', () => {
    const { events } = run(response);
    const input = events['data.input'].input;
    expect(JSON.parse(input[0])).toEqual({ state: request.state });
    expect(JSON.parse(input[1])).toEqual({ questions: request.questions });
    expect(JSON.parse(events['data.output'].response)).toEqual(response.answers);
    expect(events['data.output'].status).toBe('success');
    expect(events['metadata']).toMatchObject({ prompt_tokens: 401, completion_tokens: 69, total_tokens: 470, cost: 0.000016842 });
  });

  it('replaces images in state with a placeholder', () => {
    class Image { bytes = new Uint8Array([1, 2, 3]); }
    const attrs = config.events[0].attributes[0].accessor({ args: [{ state: { photo: new Image() }, questions: {} }] });
    expect(attrs[0]).toBe('{"state":{"photo":"[image]"}}');
  });

  it('records the error message on exception', () => {
    const { events } = run(undefined, new Error('rate limited'));
    expect(events['data.output'].response).toBe('rate limited');
    expect(events['data.output'].status).toBe('error');
  });
});

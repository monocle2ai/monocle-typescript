import { describe, it, expect } from 'vitest';
import { NonFrameworkSpanHandler } from '../../src/instrumentation/common/spanHandler';

// Runs the real handler against a fake span and returns the recorded attributes.
function run(attributes: any[][]) {
  const recorded: Record<string, any> = {};
  const span: any = {
    setAttribute: (k: string, v: any) => { recorded[k] = v; },
    addEvent: () => {},
    setStatus: () => {},
    parentSpanContext: { spanId: 'parent' },
    status: { code: 0 },
  };
  new NonFrameworkSpanHandler().processSpan({
    span, instance: {}, args: [] as any, returnValue: {},
    outputProcessor: [{ type: 'inference', attributes }], wrappedPackage: 'pkg',
  });
  return recorded;
}

const provider = [{ attribute: 'type', accessor: () => 'inference.openai' }];

describe('default model_type', () => {
  it('defaults an LLM model entity to completion', () => {
    const attrs = run([provider, [{ attribute: 'type', accessor: () => 'model.llm.gpt-4o' }]]);
    expect(attrs['entity.2.model_type']).toBe('completion');
  });

  it('keeps a model_type the metamodel set', () => {
    const attrs = run([provider, [
      { attribute: 'type', accessor: () => 'model.llm.custom' },
      { attribute: 'model_type', accessor: () => 'decision' },
    ]]);
    expect(attrs['entity.2.model_type']).toBe('decision');
  });

  it('does not tag non-LLM entities', () => {
    const attrs = run([provider, [{ attribute: 'type', accessor: () => 'model.embedding.ada' }]]);
    expect(attrs['entity.2.model_type']).toBeUndefined();
    expect(attrs['entity.1.model_type']).toBeUndefined();
  });

  it('targets the right entity index when an earlier group sets nothing', () => {
    const empty = [{ attribute: 'type', accessor: () => undefined }];
    const attrs = run([empty, [{ attribute: 'type', accessor: () => 'model.llm.x' }]]);
    expect(attrs['entity.1.type']).toBe('model.llm.x');
    expect(attrs['entity.1.model_type']).toBe('completion');
    expect(attrs['entity.2.model_type']).toBeUndefined();
  });
});

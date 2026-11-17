import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { context } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { addSystemMessage, instructionBefore } from '../../src/instructions/sending';
import { config as openaiMethods } from '../../src/instrumentation/metamodel/openai/methods';
import { getPatchedMain } from '../../src/instrumentation/common/wrapper';
import { DefaultSpanHandler } from '../../src/instrumentation/common/spanHandler';
import { MONOCLE_INSTRUCTION_ENV, SENT_INSTRUCTION, SPAN_TYPES } from '../../src/instrumentation/common/constants';

const TEXT = 'Start every answer with 123456.';
const LABELLED = JSON.stringify({ instruction: TEXT });

describe('addSystemMessage', () => {
  it('puts a system message first, leaving the developer messages as they were', () => {
    const params = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] };

    const instructed = addSystemMessage(params, TEXT);

    expect(instructed.messages).toEqual([
      { role: 'system', content: TEXT },
      { role: 'user', content: 'hi' },
    ]);
    expect(params.messages).toHaveLength(1);
  });

  it('adds nothing when the instruction is already first', () => {
    const params = { messages: [{ role: 'system', content: TEXT }, { role: 'user', content: 'hi' }] };

    expect(addSystemMessage(params, TEXT)).toBe(params);
  });

  it.each([undefined, [], 'not a list'])('returns null for messages %j', (messages) => {
    expect(addSystemMessage({ messages }, TEXT)).toBeNull();
  });
});

describe('instructionBefore', () => {
  it('uses the instruction alone when there is no system prompt', () => {
    expect(instructionBefore(TEXT, undefined)).toBe(TEXT);
  });

  it('puts the instruction ahead of the system prompt', () => {
    expect(instructionBefore(TEXT, 'Be kind.')).toBe(`${TEXT}\n\nBe kind.`);
  });

  it('adds nothing when the instruction is already ahead', () => {
    expect(instructionBefore(TEXT, `${TEXT}\n\nBe kind.`)).toBe(`${TEXT}\n\nBe kind.`);
  });

  it('returns null for a system prompt that is not text', () => {
    expect(instructionBefore(TEXT, [{ type: 'text', text: 'Be kind.' }])).toBeNull();
  });
});

describe('wrapped model calls', () => {
  let dir: string;
  let savedValue: string | undefined;
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;
  let tracer: any;

  // Without a real context manager, context.with() is a no-op and span creation recurses.
  beforeAll(() => { context.setGlobalContextManager(new AsyncHooksContextManager().enable()); });
  afterAll(() => { context.disable(); });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monocle-sending-'));
    const file = path.join(dir, 'start-with-123456.yaml');
    fs.writeFileSync(file, `name: start-with-123456\ndescription: Test marker.\ninstruction: ${TEXT}\n`);
    savedValue = process.env[MONOCLE_INSTRUCTION_ENV];
    process.env[MONOCLE_INSTRUCTION_ENV] = file;
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    tracer = provider.getTracer('test');
  });

  afterEach(async () => {
    await provider.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedValue === undefined) delete process.env[MONOCLE_INSTRUCTION_ENV];
    else process.env[MONOCLE_INSTRUCTION_ENV] = savedValue;
  });

  const chatElement: any = openaiMethods.find((e: any) => e.spanName === 'openai_chat');
  const instance = { _client: { baseURL: 'https://api.openai.com/v1' } };
  const chatResponse = { choices: [{ message: { role: 'assistant', content: '123456 hello' }, finish_reason: 'stop' }] };
  const developerParams = () => ({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });

  // A fake SDK method that records the params it was sent.
  function fakeModel(response: any = chatResponse) {
    const sent: any[] = [];
    const method = async function (params: any) {
      sent.push(params);
      return response;
    };
    return { sent, method };
  }

  const span = (name: string): ReadableSpan => {
    const found = exporter.getFinishedSpans().find((s) => s.name === name);
    if (!found) throw new Error(`no span ${name}`);
    return found;
  };
  const input = (s: ReadableSpan) => s.events.find((e) => e.name === 'data.input')?.attributes?.input as string[];

  it('sends the instruction and lists it first in the span input', async () => {
    const { sent, method } = fakeModel();
    const params = developerParams();

    await getPatchedMain({ tracer, ...chatElement })(method).call(instance, params);

    expect(sent[0].messages[0]).toEqual({ role: 'system', content: TEXT });
    expect(params.messages).toHaveLength(1);
    const chat = span('openai_chat');
    expect(chat.attributes[SENT_INSTRUCTION]).toBe('start-with-123456');
    expect(input(chat)[0]).toBe(LABELLED);
    expect(input(chat)).toHaveLength(2);
  });

  it('changes nothing when no instruction is set', async () => {
    delete process.env[MONOCLE_INSTRUCTION_ENV];
    const { sent, method } = fakeModel();

    await getPatchedMain({ tracer, ...chatElement })(method).call(instance, developerParams());

    expect(sent[0].messages).toHaveLength(1);
    const chat = span('openai_chat');
    expect(chat.attributes[SENT_INSTRUCTION]).toBeUndefined();
    expect(input(chat)).not.toContain(LABELLED);
  });

  it('sends the call as written when the instruction cannot be added', async () => {
    const { sent, method } = fakeModel();
    const params = { model: 'gpt-3.5-turbo-instruct', prompt: 'hi' };

    await getPatchedMain({ tracer, ...chatElement })(method).call(instance, params);

    expect(sent[0]).toBe(params);
    expect(span('openai_chat').attributes[SENT_INSTRUCTION]).toBeUndefined();
  });

  it('still sends the instruction when the span is skipped', async () => {
    const { sent, method } = fakeModel();

    await getPatchedMain({ tracer, ...chatElement, skipSpan: true })(method).call(instance, developerParams());

    expect(sent[0].messages[0]).toEqual({ role: 'system', content: TEXT });
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it('adds it once, and lists it once, when one wrapped call makes another', async () => {
    const responsesElement: any = openaiMethods.find((e: any) => e.spanName === 'openai_responses');
    const streamElement: any = openaiMethods.find((e: any) => e.spanName === 'openai_responses_stream');
    const { sent, method } = fakeModel({ status: 'completed', output: [] });
    const create = getPatchedMain({ tracer, ...responsesElement })(method);
    // Like Responses.stream: it calls create with the params it was given.
    const stream = getPatchedMain({ tracer, ...streamElement })(function (this: any, params: any) {
      return create.call(this, { ...params, stream: true });
    });

    await stream.call(instance, { model: 'gpt-4o-mini', input: 'hi', instructions: 'Be kind.' });

    expect(sent[0].instructions).toBe(`${TEXT}\n\nBe kind.`);
    expect(input(span('openai_responses'))).toEqual([LABELLED, "{'instructions': 'Be kind.'}", `{'input': '"hi"'}`]);
    expect(input(span('openai_responses_stream'))).toEqual([LABELLED, "{'instructions': 'Be kind.'}", `{'input': '"hi"'}`]);
  });

  it('leaves the span input alone when its reader finds no messages', async () => {
    const { sent, method } = fakeModel();
    const noMessages: any = {
      ...chatElement,
      tracer,
      output_processor: [{
        ...chatElement.output_processor[0],
        events: [{ name: 'data.input', attributes: [{ attribute: 'input', accessor: () => [] }] }],
      }],
    };

    await getPatchedMain(noMessages)(method).call(instance, developerParams());

    expect(sent[0].messages[0]).toEqual({ role: 'system', content: TEXT });
    const chat = span('openai_chat');
    expect(chat.attributes[SENT_INSTRUCTION]).toBe('start-with-123456');
    expect(input(chat)).toEqual([]);
  });

  it('labels a framework inference span without changing its call', async () => {
    const { sent, method } = fakeModel();
    const frameworkElement: any = {
      tracer,
      spanName: 'framework_chat',
      spanHandler: new DefaultSpanHandler(),
      output_processor: [{
        type: SPAN_TYPES.INFERENCE_FRAMEWORK,
        attributes: [],
        events: [{ name: 'data.input', attributes: [{ attribute: 'input', accessor: () => ['{"user": "hi"}'] }] }],
      }],
    };

    await getPatchedMain(frameworkElement)(method).call(instance, developerParams());

    expect(sent[0].messages).toHaveLength(1);
    const framework = span('framework_chat');
    expect(input(framework)).toEqual([LABELLED, '{"user": "hi"}']);
    expect(framework.attributes[SENT_INSTRUCTION]).toBeUndefined();
  });
});

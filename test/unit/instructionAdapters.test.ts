import { describe, it, expect } from 'vitest';
import { ConverseCommand, ConverseStreamCommand, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { placedFirst } from '../../src/instructions/sending';
import { addInstruction as addOpenAIInstruction } from '../../src/instrumentation/metamodel/openai/entities/inference';
import { addInstruction as addAnthropicInstruction } from '../../src/instrumentation/metamodel/anthropic/entities/inference';
import { addInstruction as addBedrockInstruction } from '../../src/instrumentation/metamodel/bedrock/entities/inference';
import { addInstruction as addGeminiInstruction } from '../../src/instrumentation/metamodel/gemini/entities/inference';

const TEXT = 'Start every answer with 123456.';
const messages = [{ role: 'user', content: 'hi' }];

describe('placedFirst', () => {
  it('puts the item first', () => {
    expect(placedFirst({ text: TEXT }, [{ text: 'Be kind.' }])).toEqual([{ text: TEXT }, { text: 'Be kind.' }]);
  });

  it('keeps the list when the item is already first', () => {
    const items = [{ text: TEXT }];

    expect(placedFirst({ text: TEXT }, items)).toBe(items);
  });
});

describe('OpenAI addInstruction', () => {
  it('adds a system message to a chat completion', () => {
    expect(addOpenAIInstruction({ messages }, TEXT).messages[0]).toEqual({ role: 'system', content: TEXT });
  });

  it('puts the instruction ahead of a Responses call\'s instructions', () => {
    const params = { input: 'hi', instructions: 'Be kind.' };

    expect(addOpenAIInstruction(params, TEXT)).toEqual({ input: 'hi', instructions: `${TEXT}\n\nBe kind.` });
    expect(params.instructions).toBe('Be kind.');
  });

  it('sets instructions on a Responses call that has none', () => {
    expect(addOpenAIInstruction({ input: messages }, TEXT).instructions).toBe(TEXT);
  });

  it('returns null for a legacy completion', () => {
    expect(addOpenAIInstruction({ model: 'gpt-3.5-turbo-instruct', prompt: 'hi' }, TEXT)).toBeNull();
  });
});

describe('Anthropic addInstruction', () => {
  it('sets system when there is none', () => {
    expect(addAnthropicInstruction({ messages }, TEXT).system).toBe(TEXT);
  });

  it('puts the instruction ahead of a text system prompt', () => {
    const params = { messages, system: 'Be kind.' };

    expect(addAnthropicInstruction(params, TEXT).system).toBe(`${TEXT}\n\nBe kind.`);
    expect(params.system).toBe('Be kind.');
  });

  it('puts a text block ahead of system blocks', () => {
    const system = [{ type: 'text', text: 'Be kind.', cache_control: { type: 'ephemeral' } }];

    expect(addAnthropicInstruction({ messages, system }, TEXT).system).toEqual([{ type: 'text', text: TEXT }, ...system]);
  });

  it('returns null for a call with no messages', () => {
    expect(addAnthropicInstruction({ model: 'claude' }, TEXT)).toBeNull();
  });
});

describe('Bedrock addInstruction', () => {
  it.each([ConverseCommand, ConverseStreamCommand])('rebuilds a %s with the instruction as its first system block', (Command) => {
    const command = new Command({ modelId: 'm', messages: [{ role: 'user', content: [{ text: 'hi' }] }], system: [{ text: 'Be kind.' }] });

    const instructed = addBedrockInstruction(command, TEXT);

    expect(instructed).toBeInstanceOf(Command);
    expect(instructed.input.system).toEqual([{ text: TEXT }, { text: 'Be kind.' }]);
    expect(command.input.system).toEqual([{ text: 'Be kind.' }]);
  });

  it('adds a system list when the command has none', () => {
    const command = new ConverseCommand({ modelId: 'm', messages: [{ role: 'user', content: [{ text: 'hi' }] }] });

    expect(addBedrockInstruction(command, TEXT).input.system).toEqual([{ text: TEXT }]);
  });

  it('returns null for InvokeModel', () => {
    const command = new InvokeModelCommand({ modelId: 'm', body: JSON.stringify({ prompt: 'hi' }) });

    expect(addBedrockInstruction(command, TEXT)).toBeNull();
  });
});

describe('Gemini addInstruction', () => {
  const contents = [{ role: 'user', parts: [{ text: 'hi' }] }];

  it('sets systemInstruction when there is none, keeping the rest of the config', () => {
    const instructed = addGeminiInstruction({ model: 'g', contents, config: { temperature: 0 } }, TEXT);

    expect(instructed.config).toEqual({ temperature: 0, systemInstruction: TEXT });
  });

  it('puts the instruction ahead of a text systemInstruction', () => {
    const params = { contents, config: { systemInstruction: 'Be kind.' } };

    expect(addGeminiInstruction(params, TEXT).config.systemInstruction).toBe(`${TEXT}\n\nBe kind.`);
    expect(params.config.systemInstruction).toBe('Be kind.');
  });

  it('puts a part ahead of a list of parts', () => {
    const config = { systemInstruction: [{ text: 'Be kind.' }] };

    expect(addGeminiInstruction({ contents, config }, TEXT).config.systemInstruction).toEqual([{ text: TEXT }, { text: 'Be kind.' }]);
  });

  it('puts a part first in a Content', () => {
    const config = { systemInstruction: { role: 'system', parts: [{ text: 'Be kind.' }] } };

    expect(addGeminiInstruction({ contents, config }, TEXT).config.systemInstruction).toEqual({
      role: 'system',
      parts: [{ text: TEXT }, { text: 'Be kind.' }],
    });
  });

  it('turns a single Part into a list', () => {
    const config = { systemInstruction: { text: 'Be kind.' } };

    expect(addGeminiInstruction({ contents, config }, TEXT).config.systemInstruction).toEqual([{ text: TEXT }, { text: 'Be kind.' }]);
  });

  it('returns null for a call that uses cached content', () => {
    expect(addGeminiInstruction({ contents, config: { cachedContent: 'cachedContents/1' } }, TEXT)).toBeNull();
  });

  it('returns null for a call with no contents', () => {
    expect(addGeminiInstruction({ model: 'g' }, TEXT)).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { context, ROOT_CONTEXT } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { AGENT, AGENT_REQUEST } from '../../src/instrumentation/metamodel/adk/entities/inference';
import { TOOL } from '../../src/instrumentation/metamodel/adk/entities/tools';
import {
    FROM_AGENT_KEY,
    FROM_AGENT_SPAN_ID_KEY,
    SPAN_TYPES,
    SPAN_SUBTYPES,
} from '../../src/instrumentation/common/constants';

// Helpers — resolve accessors by attribute name (not index) so schema
// reordering doesn't silently break tests. `group` picks the entity.N block.
function attrAccessor(schema: any, attribute: string, group = 0): Function {
    const found = schema.attributes[group].find((a: any) => a.attribute === attribute);
    if (!found) throw new Error(`no accessor for attribute "${attribute}" in group ${group}`);
    return found.accessor;
}

function eventAccessor(schema: any, eventName: string, attribute: string): Function {
    const ev = schema.events.find((e: any) => e.name === eventName);
    if (!ev) throw new Error(`no event "${eventName}"`);
    const found = ev.attributes.find((a: any) => a.attribute === attribute);
    if (!found) throw new Error(`no event attribute "${attribute}" on "${eventName}"`);
    return found.accessor;
}

// Populate the ADK delegation context keys, as ADKAgentSpanHandler.preTracing does.
function withDelegation<T>(fromAgent: string | undefined, fromSpanId: string | undefined, fn: () => T): T {
    let ctx = ROOT_CONTEXT;
    if (fromAgent !== undefined) ctx = ctx.setValue(FROM_AGENT_KEY, fromAgent);
    if (fromSpanId !== undefined) ctx = ctx.setValue(FROM_AGENT_SPAN_ID_KEY, fromSpanId);
    return context.with(ctx, fn);
}

// Delegation accessors read context.active(); OTel's default no-op manager
// ignores context.with(), so install a real one for the suite.
beforeAll(() => {
    context.setGlobalContextManager(new AsyncHooksContextManager().enable());
});
afterAll(() => {
    context.disable();
});

// =============================================================================
// AGENT schema — agentic.invocation (adk.agent.run)
// =============================================================================
describe('ADK AGENT schema', () => {
    it('declares the agentic.invocation type and content_processing subtype', () => {
        expect(AGENT.type).toBe(SPAN_TYPES.AGENTIC_INVOCATION);
        expect(AGENT.subtype).toBe(SPAN_SUBTYPES.CONTENT_PROCESSING);
    });

    it('type accessor returns the ADK agent type', () => {
        expect(attrAccessor(AGENT, 'type')({})).toBe('agent.adk');
    });

    describe('name accessor', () => {
        const name = (instance: any) => attrAccessor(AGENT, 'name')({ instance });

        it('prefers instance.name', () => {
            expect(name({ name: 'flight_agent' })).toBe('flight_agent');
        });

        it('falls back to the constructor name', () => {
            class LlmAgent {}
            expect(name(new LlmAgent())).toBe('LlmAgent');
        });

        it('returns "" when there is no instance at all', () => {
            expect(name(null)).toBe('');
            expect(name(undefined)).toBe('');
        });
    });

    describe('description accessor', () => {
        const desc = (instance: any) => attrAccessor(AGENT, 'description')({ instance });

        it('returns the instance description', () => {
            expect(desc({ description: 'books flights' })).toBe('books flights');
        });

        it('returns "" when missing', () => {
            expect(desc({})).toBe('');
            expect(desc(null)).toBe('');
        });
    });

    it('does not declare a tools attribute', () => {
        const found = AGENT.attributes[0].find((a: any) => a.attribute === 'tools');
        expect(found).toBeUndefined();
    });

    describe('delegation accessors (from_agent / from_agent_span_id)', () => {
        const fromAgent = () => attrAccessor(AGENT, 'from_agent')({});
        const fromSpanId = () => attrAccessor(AGENT, 'from_agent_span_id')({});

        it('omits both on a top-level invocation (no context keys set)', () => {
            context.with(ROOT_CONTEXT, () => {
                expect(fromAgent()).toBeUndefined();
                expect(fromSpanId()).toBeUndefined();
            });
        });

        it('surfaces from_agent and from_agent_span_id under delegation', () => {
            withDelegation('supervisor_agent', 'abc123', () => {
                expect(fromAgent()).toBe('supervisor_agent');
                expect(fromSpanId()).toBe('abc123');
            });
        });

        it('omits from_agent_span_id when from_agent is absent, even if a span id leaked into context', () => {
            // from_agent gates the trio: a stray span id alone must not leak through.
            withDelegation(undefined, 'orphan_span', () => {
                expect(fromAgent()).toBeUndefined();
                expect(fromSpanId()).toBeUndefined();
            });
        });
    });

    describe('data.input event', () => {
        const input = (args: any[]) => eventAccessor(AGENT, 'data.input', 'input')({ args });

        it('extracts the first user message from session events', () => {
            const args = [{
                session: {
                    events: [
                        { author: 'user', content: { parts: [{ text: 'Flight from Delhi to London' }] } },
                        { author: 'model', content: { parts: [{ text: 'sure' }] } },
                    ],
                },
            }];
            expect(input(args)).toEqual([JSON.stringify({ user: 'Flight from Delhi to London' })]);
        });

        it('falls back to userContent when there are no session events', () => {
            const args = [{ userContent: { parts: [{ text: 'hello there' }] } }];
            expect(input(args)).toEqual([JSON.stringify({ user: 'hello there' })]);
        });

        it('handles a plain-string content shape', () => {
            const args = [{ userContent: 'plain string message' }];
            expect(input(args)).toEqual([JSON.stringify({ user: 'plain string message' })]);
        });

        it('returns [] when nothing usable is present', () => {
            expect(input([{}])).toEqual([]);
            expect(input([])).toEqual([]);
            expect(input([{ session: { events: [] } }])).toEqual([]);
        });
    });

    describe('data.output event', () => {
        const output = (payload: any) => eventAccessor(AGENT, 'data.output', 'response')(payload);

        it('returns the last non-partial, non-user event text from an async_generator', () => {
            const response = {
                type: 'async_generator',
                events: [
                    { author: 'user', content: { parts: [{ text: 'q' }] } },
                    { author: 'model', content: { parts: [{ text: 'intermediate' }] }, partial: true },
                    { author: 'model', content: { parts: [{ text: 'final answer' }] } },
                ],
            };
            expect(output({ response })).toBe('final answer');
        });

        it('skips trailing partial / user events when picking the final response', () => {
            const response = {
                type: 'async_generator',
                events: [
                    { author: 'model', content: { parts: [{ text: 'the real answer' }] } },
                    { author: 'model', content: { parts: [{ text: 'streaming...' }] }, partial: true },
                    { author: 'user', content: { parts: [{ text: 'follow up' }] } },
                ],
            };
            expect(output({ response })).toBe('the real answer');
        });

        it('returns "" for a non-generator / empty response', () => {
            expect(output({ response: undefined })).toBe('');
            expect(output({ response: { type: 'other' } })).toBe('');
            expect(output({ response: { type: 'async_generator', events: [] } })).toBe('');
        });

        it('returns the exception message when the call threw', () => {
            expect(output({ exception: new Error('agent blew up') })).toBe('agent blew up');
        });
    });
});

// =============================================================================
// AGENT_REQUEST schema — agentic.turn (adk.runner.run_async / run_ephemeral)
// =============================================================================
describe('ADK AGENT_REQUEST schema', () => {
    it('declares the agentic.turn type and turn subtype', () => {
        expect(AGENT_REQUEST.type).toBe('agentic.turn');
        expect(AGENT_REQUEST.subtype).toBe(SPAN_SUBTYPES.TURN);
    });

    it('type accessor returns the ADK agent type', () => {
        expect(attrAccessor(AGENT_REQUEST, 'type')({})).toBe('agent.adk');
    });

    it('declares only the entity type — no name or app_name attributes', () => {
        const attrs = AGENT_REQUEST.attributes[0].map((a: any) => a.attribute);
        expect(attrs).toEqual(['type']);
    });

    describe('data.input event', () => {
        const input = (args: any[]) => eventAccessor(AGENT_REQUEST, 'data.input', 'input')({ args });

        it('extracts the new message keyed by its role', () => {
            const args = [{ newMessage: { role: 'user', parts: [{ text: 'Book a flight' }] } }];
            expect(input(args)).toEqual([JSON.stringify({ user: 'Book a flight' })]);
        });

        it('defaults the role to "user" when unset', () => {
            const args = [{ newMessage: { parts: [{ text: 'no role here' }] } }];
            expect(input(args)).toEqual([JSON.stringify({ user: 'no role here' })]);
        });

        it('returns [] when there is no new message or text', () => {
            expect(input([{}])).toEqual([]);
            expect(input([{ newMessage: { parts: [] } }])).toEqual([]);
        });
    });

    describe('data.output event', () => {
        const output = (payload: any) => eventAccessor(AGENT_REQUEST, 'data.output', 'response')(payload);

        it('returns the final response across the run', () => {
            const response = {
                type: 'async_generator',
                events: [{ author: 'model', content: { parts: [{ text: 'run complete' }] } }],
            };
            expect(output({ response })).toBe('run complete');
        });

        it('returns the exception message on failure', () => {
            expect(output({ exception: new Error('runner failed') })).toBe('runner failed');
        });
    });
});

// =============================================================================
// TOOL schema — agentic.tool.invocation (adk.tool)
// =============================================================================
describe('ADK TOOL schema', () => {
    it('declares the agentic.tool.invocation type and content_generation subtype', () => {
        expect(TOOL.type).toBe(SPAN_TYPES.AGENTIC_TOOL_INVOCATION);
        expect(TOOL.subtype).toBe(SPAN_SUBTYPES.CONTENT_GENERATION);
    });

    describe('entity group 0 — the tool itself', () => {
        it('type accessor returns the ADK tool type', () => {
            expect(attrAccessor(TOOL, 'type', 0)({})).toBe('tool.adk');
        });

        it('name accessor returns the tool name (or "")', () => {
            expect(attrAccessor(TOOL, 'name', 0)({ instance: { name: 'book_flight' } })).toBe('book_flight');
            expect(attrAccessor(TOOL, 'name', 0)({ instance: {} })).toBe('');
        });

        it('description accessor returns the tool description (or "")', () => {
            expect(attrAccessor(TOOL, 'description', 0)({ instance: { description: 'books a flight' } }))
                .toBe('books a flight');
            expect(attrAccessor(TOOL, 'description', 0)({ instance: {} })).toBe('');
        });
    });

    describe('entity group 1 — the owning agent', () => {
        it('type accessor returns the ADK agent type', () => {
            expect(attrAccessor(TOOL, 'type', 1)({})).toBe('agent.adk');
        });

        it('name accessor reads the owning agent off the tool context', () => {
            const args = [{ toolContext: { invocationContext: { agent: { name: 'flight_agent' } } } }];
            expect(attrAccessor(TOOL, 'name', 1)({ args })).toBe('flight_agent');
        });

        it('name accessor returns "" when the chain is absent', () => {
            expect(attrAccessor(TOOL, 'name', 1)({ args: [{}] })).toBe('');
            expect(attrAccessor(TOOL, 'name', 1)({ args: [] })).toBe('');
        });
    });

    describe('data.input event', () => {
        const inputs = (args: any[]) => eventAccessor(TOOL, 'data.input', 'Inputs')({ args });

        it('serializes the validated tool args', () => {
            const args = [{ args: { from: 'SFO', to: 'BOM' } }];
            expect(inputs(args)).toEqual([JSON.stringify({ from: 'SFO', to: 'BOM' })]);
        });

        it('returns [""] when there are no args', () => {
            expect(inputs([{}])).toEqual(['']);
            expect(inputs([])).toEqual(['']);
        });
    });

    describe('data.output event', () => {
        const output = (payload: any) => eventAccessor(TOOL, 'data.output', 'response')(payload);

        it('passes through a string result', () => {
            expect(output({ response: 'Flight booked from SFO to BOM' })).toBe('Flight booked from SFO to BOM');
        });

        it('JSON-stringifies an object result', () => {
            expect(output({ response: { status: 'success', id: 42 } }))
                .toBe(JSON.stringify({ status: 'success', id: 42 }));
        });

        it('returns "" for null / undefined results', () => {
            expect(output({ response: null })).toBe('');
            expect(output({ response: undefined })).toBe('');
        });

        it('returns the exception message when the tool threw', () => {
            expect(output({ exception: new Error('tool failed') })).toBe('tool failed');
        });
    });
});

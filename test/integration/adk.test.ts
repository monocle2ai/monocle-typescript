import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';

describe('ADK instrumentation', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const capturedSpans: any[] = [];

    beforeEach(() => {
        consoleSpy.mockImplementation((message: any) => {
            try {
                if (typeof message === 'string') {
                    capturedSpans.push(JSON.parse(message));
                }
            } catch {
                // non-JSON console output — ignore
            }
        });
    });

    afterEach(() => {
        consoleSpy.mockReset();
        capturedSpans.length = 0;
    });

    it('emits a tool span for FunctionTool.runAsync', async () => {
        const sample = require('../examples/adkToolSample.js');
        const result = await sample.main();
        expect(result.status).toBe('success');

        // BatchSpanProcessor flushes on a timer (5s default).
        await new Promise((r) => setTimeout(r, 6000));

        const toolSpan = capturedSpans.find((s) => s?.name === 'adk.tool');
        expect(toolSpan, 'expected an adk.tool span to be emitted').toBeDefined();
        expect(toolSpan.attributes['span.type']).toBe('agentic.tool.invocation');
        expect(toolSpan.attributes['entity.1.type']).toBe('tool.adk');
        expect(toolSpan.attributes['entity.1.name']).toBe('adk_book_flight');
        expect(toolSpan.attributes['entity.2.type']).toBe('agent.adk');
        expect(toolSpan.attributes['entity.2.name']).toBe('adk_flight_booking_agent');

        const inputEvent = toolSpan.events.find((e: any) => e.name === 'data.input');
        const outputEvent = toolSpan.events.find((e: any) => e.name === 'data.output');
        expect(inputEvent.attributes.Inputs[0]).toContain('SFO');
        expect(inputEvent.attributes.Inputs[0]).toContain('BOM');
        expect(outputEvent.attributes.response).toContain('Flight booked from SFO to BOM');
    }, 30000);

    it('emits an agent span for BaseAgent.runAsync iteration', async () => {
        const sample = require('../examples/adkAgentSample.js');
        const events = await sample.main();
        expect(events.length).toBeGreaterThan(0);

        await new Promise((r) => setTimeout(r, 6000));

        const agentSpan = capturedSpans.find((s) => s?.name === 'adk.agent.run');
        expect(agentSpan, 'expected an adk.agent.run span to be emitted').toBeDefined();
        expect(agentSpan.attributes['span.type']).toBe('agentic.invocation');
        expect(agentSpan.attributes['entity.1.type']).toBe('agent.adk');
        expect(agentSpan.attributes['entity.1.name']).toBe('adk_smoke_agent');

        const inputEvent = agentSpan.events.find((e: any) => e.name === 'data.input');
        const outputEvent = agentSpan.events.find((e: any) => e.name === 'data.output');
        expect(inputEvent.attributes.input[0]).toContain('Book me a flight');
        expect(outputEvent.attributes.response).toContain('hello from stub');
    }, 30000);

    it('tool invoked from inside real BaseAgent.runAsync is parented to agent.run', async () => {
        // Regression guard for the bug where ADK's internal no-op spans
        // (tracer.startSpan('invoke_agent X') in BaseAgent.runAsync) polluted
        // the OTel active-span slot, so a tool invoked from runAsyncImpl
        // ended up parented to whatever was *outside* the agent span.
        const sample = require('../examples/adkRealAgentSample.js');
        const events = await sample.main();
        expect(events.length).toBeGreaterThan(0);

        await new Promise((r) => setTimeout(r, 6000));

        const workflow = capturedSpans.find((s) => s?.name === 'workflow');
        const agent = capturedSpans.find((s) => s?.name === 'adk.agent.run');
        const tool = capturedSpans.find((s) => s?.name === 'adk.tool');

        expect(workflow).toBeDefined();
        expect(agent).toBeDefined();
        expect(tool).toBeDefined();

        // All three spans share one trace_id.
        const traceId = workflow.context.trace_id;
        expect(agent.context.trace_id).toBe(traceId);
        expect(tool.context.trace_id).toBe(traceId);

        // Parent chain: tool -> agent.run -> workflow -> root.
        // Tool must be parented to agent.run, NOT to workflow (which would
        // happen if ADK's no-op invoke_agent span polluted parent selection).
        expect(tool.parent_id).toBe(agent.context.span_id);
        expect(agent.parent_id).toBe(workflow.context.span_id);
        expect(workflow.parent_id == null).toBe(true);
    }, 30000);

    it('nested AsyncGenerators share trace_id and form a parent chain', async () => {
        const sample = require('../examples/adkNestedSample.js');
        const events = await sample.main();
        expect(events.length).toBeGreaterThan(0);

        await new Promise((r) => setTimeout(r, 6000));

        const workflow = capturedSpans.find((s) => s?.name === 'workflow');
        const ephemeral = capturedSpans.find((s) => s?.name === 'adk.runner.run_ephemeral');
        const innerRunAsync = capturedSpans.find((s) => s?.name === 'adk.runner.run_async');
        const agent = capturedSpans.find((s) => s?.name === 'adk.agent.run');

        expect(workflow, 'workflow span').toBeDefined();
        expect(ephemeral, 'adk.runner.run_ephemeral span').toBeDefined();
        expect(agent, 'adk.agent.run span').toBeDefined();

        // Only one runner span per turn — the inner runAsync that
        // runEphemeral delegates to must be suppressed by the
        // ADK_TURN_SPAN_ACTIVE_KEY skipSpan gate.
        expect(innerRunAsync, 'inner adk.runner.run_async span should be deduped').toBeUndefined();

        // All emitted spans share one trace_id
        const traceId = workflow.context.trace_id;
        expect(ephemeral.context.trace_id).toBe(traceId);
        expect(agent.context.trace_id).toBe(traceId);

        // Parent chain: agent -> ephemeral -> workflow -> root
        expect(agent.parent_id).toBe(ephemeral.context.span_id);
        expect(ephemeral.parent_id).toBe(workflow.context.span_id);
        expect(workflow.parent_id == null).toBe(true);
    }, 30000);
});

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { setScopes, setScopesBind, startTrace, getScopes, setupMonocle } from '../../src/instrumentation/common/instrumentation';
// import { context, trace } from '@opentelemetry/api';
// import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';

describe('Instrumentation Functions', () => {
    beforeAll(() => {
        setupMonocle('test-workflow');
    });

    beforeEach(() => {
        // Clear any existing scopes
        process.env = {};
    });

    describe('setScopes and getScopes', () => {
        it('should set and get scopes correctly', async () => {
            const scopes = { userId: '123', orgId: '456' };
            
            const testFunction = () => {
                const currentScopes = getScopes();
                expect(currentScopes).toEqual(scopes);
                return 'test completed';
            };

            const result = await setScopes(scopes, testFunction);
            expect(result).toBe('test completed');
        });

        it('should handle null values in scopes', async () => {
            const scopes = { userId: null, orgId: '456' };
            
            const testFunction = () => {
                const currentScopes = getScopes();
                expect(currentScopes.orgId).toEqual('456');
                // expect that userId is a uuidv4
                expect(currentScopes.userId).toMatch(
                    /^[0-9a-f]{8}[0-9a-f]{4}[0-9a-f]{4}[0-9a-f]{4}[0-9a-f]{12}$/
                );

                
                return true;
            };

            const result = await setScopes(scopes, testFunction);
            expect(result).toBe(true);
        });
    });

    describe('setScopesBind', () => {
        it('should bind scopes to function', async () => {
            const scopes = { userId: '123' };
            const originalFn = () => {
                const currentScopes = getScopes();
                expect(currentScopes).toEqual(scopes);
                return 'bound function executed';
            };

            const boundFn = setScopesBind(scopes, originalFn);
            const result = await boundFn();
            expect(result).toBe('bound function executed');
        });
    });

    describe('startTrace', () => {
        it('should execute function with tracing', async () => {
            const testFunction = () => 'traced function';
            const result = await startTrace(testFunction);
            expect(result).toBe('traced function');
        });

        it('should handle async functions', async () => {
            const asyncFunction = async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'async complete';
            };

            const result = await startTrace(asyncFunction);
            expect(result).toBe('async complete');
        });
    });
});

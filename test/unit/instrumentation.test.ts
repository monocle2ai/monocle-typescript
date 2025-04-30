import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupMonocle, setScopes, setScopesBind, startTrace } from '../../src/instrumentation/common/instrumentation';
import { context, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

// Mock dependencies
vi.mock('@opentelemetry/api', () => {
  const contextMock = {
    active: vi.fn(() => ({
      setValue: vi.fn().mockReturnThis(),
      getValue: vi.fn(),
    })),
    with: vi.fn((ctx, fn) => fn()),
    setGlobalContextManager: vi.fn(),
  };
  
  return {
    context: contextMock,
    SpanStatusCode: {
      UNSET: 0,
      OK: 1,
      ERROR: 2,
    },
    trace: {
      getTracer: vi.fn().mockReturnValue({
        startActiveSpan: vi.fn((name, fn) => {
          const mockSpan = {
            setAttribute: vi.fn(),
            addEvent: vi.fn(),
            updateName: vi.fn(),
            setStatus: vi.fn(),
            end: vi.fn(),
          };
          return fn(mockSpan);
        }),
      }),
    },
  };
});

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: vi.fn().mockReturnValue({ attributes: { SERVICE_NAME: 'test-service' } }),
}));

// Create a class-like mock structure that Vitest can properly instantiate
const mockContextManager = {
  enable: vi.fn(),
  disable: vi.fn(),
};

vi.mock('@opentelemetry/context-async-hooks', () => {
  return {
    AsyncHooksContextManager: vi.fn().mockImplementation(() => mockContextManager),
  };
});

vi.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: vi.fn().mockImplementation(() => ({
    addSpanProcessor: vi.fn(),
    register: vi.fn(),
  })),
  ConsoleSpanExporter: vi.fn().mockImplementation(() => ({
    export: vi.fn(),
  })),
}));

vi.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: vi.fn().mockImplementation(() => ({})),
  SimpleSpanProcessor: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/exporters', () => ({
  getMonocleExporters: vi.fn().mockReturnValue([{ export: vi.fn() }]),
}));

vi.mock('../../src/instrumentation/common/opentelemetryUtils', () => ({
  PatchedBatchSpanProcessor: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/common/logging', () => ({
  consoleLog: vi.fn(),
}));

vi.mock('../../src/instrumentation/common/utils', () => ({
  setScopesInternal: vi.fn((scopes, ctx, fn, thisArg, ...args) => fn.apply(thisArg, args)),
  setScopesBindInternal: vi.fn((scopes, ctx, fn) => fn),
  startTraceInternal: vi.fn((fn, thisArg, ...args) => fn.apply(thisArg, args)),
  getScopesInternal: vi.fn().mockReturnValue({ testScope: 'testValue' }),
  setInstrumentor: vi.fn(),
  load_scopes: vi.fn().mockReturnValue([]),
}));

vi.mock('require-in-the-middle', () => ({
  Hook: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('import-in-the-middle', () => ({
  Hook: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./esmModule', () => ({
  registerModule: vi.fn(),
}), { virtual: true });

describe('instrumentation module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    vi.resetAllMocks();
  });
  
  describe('setScopes', () => {
    it('should call setScopesInternal with the provided scopes and function', async () => {
      const scopes = { userId: '123', orgId: '456' };
      const testFn = vi.fn().mockReturnValue('result');
      
      const result = await setScopes(scopes, testFn, {}, 'arg1', 'arg2');
      
      expect(result).toBe('result');
      expect(testFn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });
  
  describe('setScopesBind', () => {
    it('should call setScopesBindInternal with the provided scopes and function', () => {
      const scopes = { userId: '123', orgId: '456' };
      const testFn = vi.fn().mockReturnValue('result');
      
      const boundFn = setScopesBind(scopes, testFn);
      const result = boundFn('arg1', 'arg2');
      
      expect(result).toBe('result');
      expect(testFn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });
  
  describe('startTrace', () => {
    it('should call startTraceInternal with the provided function', async () => {
      const testFn = vi.fn().mockReturnValue('result');
      
      const result = await startTrace(testFn, {}, 'arg1', 'arg2');
      
      expect(result).toBe('result');
      expect(testFn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });
  
  describe('setupMonocle', () => {
    // it('should set up the tracer provider and register instrumentation', () => {
    //   const result = setupMonocle('test-workflow');
      
    //   expect(NodeTracerProvider).toHaveBeenCalled();
    //   expect(context.setGlobalContextManager).toHaveBeenCalled();
    //   expect(result).toBeDefined();
    // });
    
    // it('should use provided span processors if specified', () => {
    //   const mockProcessor = new BatchSpanProcessor(new ConsoleSpanExporter());
      
    //   const result = setupMonocle('test-workflow', [mockProcessor]);
      
    //   expect(NodeTracerProvider).toHaveBeenCalledWith(expect.objectContaining({
    //     spanProcessors: expect.arrayContaining([mockProcessor])
    //   }));
    //   expect(result).toBeDefined();
    // });
    
    // it('should handle custom wrapper methods', () => {
    //   const customWrapperMethod = {
    //     package: 'custom-package',
    //     object: 'CustomObject',
    //     method: 'customMethod'
    //   };
      
    //   const result = setupMonocle('test-workflow', [], [customWrapperMethod]);
      
    //   expect(result).toBeDefined();
    //   // Would need to inspect the MonocleInstrumentation instance to verify this properly
    // });
    
    it('should throw error if both spanProcessors and exporter_list are provided', () => {
      const mockProcessor = new BatchSpanProcessor(new ConsoleSpanExporter());
      
      expect(() => setupMonocle('test-workflow', [mockProcessor], [], 'console')).toThrow(
        'Cannot set both spanProcessors and exporter_list.'
      );
    });
  });
});

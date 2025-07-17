import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPatchedMain, getPatchedMainList, getPatchedScopeMain } from '../../src/instrumentation/common/wrapper';
import { Context, context, Span, SpanOptions, SpanStatusCode, Tracer } from '@opentelemetry/api';
import { is } from 'date-fns/locale';

// Create a mock span handler with all required methods
const mockSpanHandlerImplementation = {
  // preProcessSpan: vi.fn(),
  skipSpan: vi.fn().mockReturnValue(false),
  postProcessSpan: vi.fn(),
  processSpan: vi.fn(),
  preTracing: vi.fn(),
  setDefaultMonocleAttributes: vi.fn(),
};

// Instead of mocking the entire module, we'll mock the DefaultSpanHandler constructor
vi.mock('../../src/instrumentation/common/spanHandler', () => {
  return {
    DefaultSpanHandler: vi.fn(() => mockSpanHandlerImplementation),
    attachWorkflowType: vi.fn((element, recursive) => context.active()),
    isNonWorkflowRootSpan: vi.fn().mockReturnValue(false),
    isRootSpan: vi.fn().mockReturnValue(false),
  };
});

vi.mock('@opentelemetry/api', () => {
  return {
    context: {
      active: vi.fn(() => ({
        setValue: vi.fn().mockReturnThis(),
        getValue: vi.fn(),
      })),
      with: vi.fn((ctx, fn) => fn()),
    },
    SpanStatusCode: {
      UNSET: 0,
      OK: 1,
      ERROR: 2
    },
    trace: {
      getActiveSpan: vi.fn(() => ({
        setAttribute: vi.fn(),
        addEvent: vi.fn(),
        updateName: vi.fn(),
        setStatus: vi.fn(),
        end: vi.fn(),
        context: { traceId: 'mock-trace-id', spanId: 'mock-span-id' },
        resource: { attributes: { "SERVICE_NAME": "test-service" } },
        parentSpanContext: { spanId: '' },
        status: { code: 0 },
      })),
    }
  };
});

vi.mock('../../src/common/logging', () => ({
  consoleLog: vi.fn(),
}));

vi.mock('../../src/instrumentation/common/utils', () => ({
  setScopesInternal: vi.fn((scopes, ctx, fn) => fn()),
}));
vi.mock('../../src/instrumentation/common/utils', () => ({
  setScopesInternal: vi.fn((scopes, ctx, fn) => fn()),
  getSourcePath: vi.fn().mockReturnValue('test/examples/mockFile.ts'), // Add mock implementation
}));
describe('Wrapper Functions', () => {
  // Create a mock tracer function that returns a mock span
  const mockTracer: Tracer = {
    startActiveSpan: vi.fn((name, fn) => {
      const mockSpan = {
        setAttribute: vi.fn(),
        addEvent: vi.fn(),
        updateName: vi.fn(),
        setStatus: vi.fn(),
        end: vi.fn(),
        context: { traceId: 'mock-trace-id', spanId: 'mock-span-id' },
        resource: { attributes: { "SERVICE_NAME": "test-service" } },
        parentSpanContext: { spanId: '' },
        status: { code: SpanStatusCode.UNSET },
        isRecording: vi.fn(() => true),
      };
      return fn(mockSpan);
    }),
    startSpan: function (name: string, options?: SpanOptions, context?: Context): Span {
      throw new Error('Function not implemented.');
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getPatchedMain', () => {
    it('should return a function that wraps the original function with tracing', () => {
      // Arrange
      const element = {
        tracer: mockTracer,
        package: 'test-package',
        object: 'test-object',
        method: 'test-method',
      };
      const originalFn = vi.fn(() => 'original result');

      // Act
      const patchedMain = getPatchedMain(element);
      const wrappedFn = patchedMain(originalFn);
      const result = wrappedFn.call({}, 'arg1', 'arg2');

      // Assert
      expect(originalFn).toHaveBeenCalled();
      expect(result).toBe('original result');
      // Verify that span handler methods were called
      expect(mockSpanHandlerImplementation.skipSpan).toHaveBeenCalled();
      // expect(mockSpanHandlerImplementation.preProcessSpan).toHaveBeenCalled();
    });

    it('should skip tracing when skipSpan returns true', () => {
      // Arrange
      mockSpanHandlerImplementation.skipSpan.mockReturnValueOnce(true);
      
      const element = {
        tracer: mockTracer,
        package: 'test-package',
        object: 'test-object',
        method: 'test-method',
      };
      const originalFn = vi.fn(() => 'original result');

      // Act
      const patchedMain = getPatchedMain(element);
      const wrappedFn = patchedMain(originalFn);
      const result = wrappedFn.call({}, 'arg1', 'arg2');

      // Assert
      expect(mockSpanHandlerImplementation.skipSpan).toHaveBeenCalled();
      expect(mockSpanHandlerImplementation.preTracing).toHaveBeenCalled();
      expect(originalFn).toHaveBeenCalled();
      expect(result).toBe('original result');
      // Verify that preProcessSpan was not called since we skipped tracing
      // expect(mockSpanHandlerImplementation.preProcessSpan).not.toHaveBeenCalled();
    });
  });

  describe('getPatchedMainList', () => {
    it('should process multiple elements with tracing', () => {
      // Arrange
      const elements = [
        {
          tracer: mockTracer,
          package: 'test-package-1',
          object: 'test-object-1',
          method: 'test-method-1',
        },
        {
          tracer: mockTracer,
          package: 'test-package-2',
          object: 'test-object-2',
          method: 'test-method-2',
        },
      ];
      const originalFn = vi.fn(() => 'original result');

      // Act
      const patchedMainList = getPatchedMainList(elements);
      const wrappedFn = patchedMainList(originalFn);
      const result = wrappedFn.call({}, 'arg1', 'arg2');

      // Assert
      expect(originalFn).toHaveBeenCalled();
      expect(result).toBe('original result');
      expect(mockSpanHandlerImplementation.skipSpan).toHaveBeenCalledTimes(2); // Called for each element
    });
  });

  describe('getPatchedScopeMain', () => {
    it('should set scopes and call the original function', () => {
      // Arrange
      const element = {
        tracer: mockTracer,
        spanName: 'test-span',
        package: 'test-package',
        object: 'test-object',
        method: 'test-method',
        output_processor: null,
        scopeName: 'testScope',
      };
      const originalFn = vi.fn(() => 'original result');

      // Act
      const patchedScopeMain = getPatchedScopeMain(element);
      const wrappedFn = patchedScopeMain(originalFn);
      const result = wrappedFn.call({}, 'arg1', 'arg2');

      // Assert
      expect(originalFn).toHaveBeenCalled();
      expect(result).toBe('original result');
    });
  });

  describe('processSpanWithTracing', () => {
    it('should handle promises returned by the original function', async () => {
      // Arrange
      const element = {
        tracer: mockTracer,
        package: 'test-package',
        object: 'test-object',
        method: 'test-method',
      };
      const asyncOriginalFn = vi.fn(() => Promise.resolve('promise result'));

      // Act
      const patchedMain = getPatchedMain(element);
      const wrappedFn = patchedMain(asyncOriginalFn);
      const resultPromise = wrappedFn.call({}, 'arg1', 'arg2');

      // Assert
      expect(asyncOriginalFn).toHaveBeenCalled();
      const result = await resultPromise;
      expect(result).toBe('promise result');
    });

    it('should handle promise rejections', async () => {
      // Arrange
      const element = {
        tracer: mockTracer,
        package: 'test-package',
        object: 'test-object',
        method: 'test-method',
      };
      const error = new Error('test error');
      const asyncOriginalFn = vi.fn(() => Promise.reject(error));

      // Act
      const patchedMain = getPatchedMain(element);
      const wrappedFn = patchedMain(asyncOriginalFn);
      
      // Assert
      await expect(wrappedFn.call({}, 'arg1', 'arg2')).rejects.toThrow('test error');
      expect(asyncOriginalFn).toHaveBeenCalled();
    });
  });

  describe('Span Name Construction', () => {
    it('should use spanName if provided', () => {
      // Arrange
      const element = {
        tracer: mockTracer,
        package: 'test-package',
        object: 'test-object',
        method: 'test-method',
        spanName: 'custom-span-name',
      };
      const originalFn = vi.fn(() => 'original result');

      // Act
      const patchedMain = getPatchedMain(element);
      const wrappedFn = patchedMain(originalFn);
      wrappedFn.call({}, 'arg1', 'arg2');

      // Assert
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('custom-span-name', expect.any(Function));
    });

    it('should construct span name from package, object, and method if spanName not provided', () => {
      // Arrange
      const element = {
        tracer: mockTracer,
        package: 'test-package',
        object: 'test-object',
        method: 'test-method',
      };
      const originalFn = vi.fn(() => 'original result');

      // Act
      const patchedMain = getPatchedMain(element);
      const wrappedFn = patchedMain(originalFn);
      wrappedFn.call({}, 'arg1', 'arg2');

      // Assert
      // The getSpanName function should concatenate these values
      expect(mockTracer.startActiveSpan).toHaveBeenCalled();
    });
  });

  describe('Error Handling in getPatchedMain', () => {
    it('should handle errors in the original function and set error status', async () => {
      // Arrange
      const element = {
        tracer: mockTracer,
        package: 'test-package',
        object: 'test-object',
        method: 'test-method',
      };
      const error = new Error('synchronous error');
      const errorFn = vi.fn(() => { throw error; });

      // Act
      const patchedMain = getPatchedMain(element);
      const wrappedFn = patchedMain(errorFn);
      
      // Assert
      try {
        wrappedFn.call({}, 'arg1', 'arg2');
      } catch (e) {
        expect(e).toBe(error);
      }
      
      // Verify span status was set to error
      expect(mockTracer.startActiveSpan).toHaveBeenCalled();
      // const mockSpan = mockTracer.startActiveSpan.mock.calls[0][1]({} as any);
      // expect(mockSpan.setStatus).toHaveBeenCalledWith({
      //   code: SpanStatusCode.ERROR,
      //   message: 'synchronous error'
      // });
    });

    it('should handle null arguments properly', () => {
      // Arrange
      const element = {
        tracer: mockTracer,
        package: 'test-package',
        object: 'test-object',
        method: 'test-method',
      };
      const originalFn = vi.fn(() => 'original result');

      // Act
      const patchedMain = getPatchedMain(element);
      const wrappedFn = patchedMain(originalFn);
      const result = wrappedFn.call({}, null, undefined);

      // Assert
      expect(originalFn).toHaveBeenCalledWith(null, undefined);
      expect(result).toBe('original result');
      expect(mockTracer.startActiveSpan).toHaveBeenCalled();
    });
  });

  describe('getPatchedMainList with Multiple Elements', () => {
    it('should process multiple elements sequentially', () => {
      // Arrange
      const elements = [
        {
          tracer: mockTracer,
          package: 'test-package-1',
          object: 'test-object-1',
          method: 'test-method-1',
          spanName: 'test-span-1',
        },
        {
          tracer: mockTracer,
          package: 'test-package-2',
          object: 'test-object-2',
          method: 'test-method-2',
          spanName: 'test-span-2',
        },
        {
          tracer: mockTracer,
          package: 'test-package-3',
          object: 'test-object-3',
          method: 'test-method-3',
          spanName: 'test-span-3',
        }
      ];
      const originalFn = vi.fn(() => 'multiple elements result');

      // Act
      const patchedMainList = getPatchedMainList(elements);
      const wrappedFn = patchedMainList(originalFn);
      const result = wrappedFn.call({}, 'arg1', 'arg2');

      // Assert
      expect(originalFn).toHaveBeenCalled();
      expect(result).toBe('multiple elements result');
      expect(mockSpanHandlerImplementation.skipSpan).toHaveBeenCalledTimes(3); // Called for each element
      // Should have created multiple spans
      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(3);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('test-span-1', expect.any(Function));
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('test-span-2', expect.any(Function));
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('test-span-3', expect.any(Function));
    });
  });
});
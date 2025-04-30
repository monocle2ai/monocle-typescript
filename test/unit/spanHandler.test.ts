import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  DefaultSpanHandler, 
  NonFrameworkSpanHandler, 
  isRootSpan, 
  attachWorkflowType 
} from '../../src/instrumentation/common/spanHandler';
import { 
  WORKFLOW_TYPE_GENERIC, 
  WORKFLOW_TYPE_KEY_SYMBOL,
  MONOCLE_SDK_LANGUAGE,
  MONOCLE_SDK_VERSION,
  WrapperArguments
} from '../../src/instrumentation/common/constants';
import { context, SpanStatusCode } from '@opentelemetry/api';
import { MONOCLE_VERSION } from '../../src/instrumentation/common/monocle_version';

// Mock dependencies
vi.mock('@opentelemetry/api', () => {
  const contextMock = {
    active: vi.fn(() => ({
      setValue: vi.fn().mockReturnThis(),
      getValue: vi.fn(),
    })),
    with: vi.fn((ctx, fn) => fn()),
  };
  
  return {
    context: contextMock,
    SpanStatusCode: {
      UNSET: 0,
      OK: 1,
      ERROR: 2,
    },
  };
});

vi.mock('../../src/instrumentation/common/utils', () => ({
  getScopesInternal: vi.fn().mockReturnValue({ testScope: 'testValue' }),
}));

describe('isRootSpan', () => {
  it('should return true when parentSpanContext.spanId is empty', () => {
    const mockSpan = { parentSpanContext: { spanId: '' } };
    expect(isRootSpan(mockSpan)).toBe(true);
  });

  it('should return false when parentSpanContext.spanId is not empty', () => {
    const mockSpan = { parentSpanContext: { spanId: '12345' } };
    expect(isRootSpan(mockSpan)).toBe(false);
  });

  it('should return true when parentSpanContext is undefined', () => {
    const mockSpan = { parentSpanContext: undefined };
    expect(isRootSpan(mockSpan)).toBe(true);
  });
});

describe('DefaultSpanHandler', () => {
  let spanHandler: DefaultSpanHandler;
  let mockSpan: any;

  beforeEach(() => {
    spanHandler = new DefaultSpanHandler();
    mockSpan = {
      setAttribute: vi.fn(),
      updateName: vi.fn(),
      setStatus: vi.fn(),
      addEvent: vi.fn(),
      resource: {
        attributes: {
          'SERVICE_NAME': 'test-service'
        }
      },
      spanContext: vi.fn().mockReturnValue({ traceId: '12345' }),
      status: { code: SpanStatusCode.UNSET }
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('skipProcessor', () => {
    it('should return false by default', () => {
      expect(spanHandler.skipProcessor({} as any)).toBe(false);
    });
  });

  describe('skipSpan', () => {
    it('should return true if workflow span is active and element.spanType is workflow', () => {
      vi.spyOn(context, 'active').mockReturnValue({ 
        getValue: vi.fn().mockReturnValue('workflow.langchain') 
      } as any);
      
      const mockElement = { spanType: 'workflow' } as WrapperArguments;
      expect(spanHandler.skipSpan({ instance: {}, args: {} as IArguments, element: mockElement })).toBe(true);
    });

    it('should return false if workflow span is not active', () => {
      vi.spyOn(context, 'active').mockReturnValue({ 
        getValue: vi.fn().mockReturnValue(null) 
      } as any);
      
      const mockElement = { spanType: 'workflow' } as WrapperArguments;
      expect(spanHandler.skipSpan({ instance: {}, args: {} as IArguments, element: mockElement })).toBe(false);
    });

    it('should return false if element.spanType is not workflow', () => {
      vi.spyOn(context, 'active').mockReturnValue({ 
        getValue: vi.fn().mockReturnValue('workflow.langchain') 
      } as any);
      
      const mockElement = { spanType: 'inference' } as WrapperArguments;
      expect(spanHandler.skipSpan({ instance: {}, args: {} as IArguments, element: mockElement })).toBe(false);
    });
  });

  describe('setDefaultMonocleAttributes', () => {
    it('should set default monocle attributes on the span', () => {
      spanHandler.setDefaultMonocleAttributes({ 
        span: mockSpan, 
        instance: {}, 
        args: {} as IArguments, 
        element: {} as WrapperArguments 
      });
      
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(MONOCLE_SDK_VERSION, MONOCLE_VERSION);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(MONOCLE_SDK_LANGUAGE, 'js');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('workflow.name', 'test-service');
    //   expect(mockSpan.setAttribute).toHaveBeenCalledWith('scope.testScope', 'testValue');
    });
  });

  describe('setWorkflowProperties', () => {
    it('should set workflow attributes and app hosting identifier', () => {
      spanHandler.setWorkflowProperties({ 
        span: mockSpan, 
        instance: {}, 
        args: {} as IArguments, 
        element: { package: 'langchain' } as WrapperArguments 
      });
      
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('span.type', 'workflow');
      expect(mockSpan.updateName).toHaveBeenCalledWith('workflow');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('entity.1.name', 'test-service');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('entity.1.type', 'workflow.langchain');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('entity.2.type', 'app_hosting.generic');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('entity.2.name', 'generic');
    });
  });

  describe('postProcessSpan', () => {
    it('should set status to OK if status is UNSET', () => {
      spanHandler.postProcessSpan({ 
        span: mockSpan, 
        instance: {}, 
        args: {} as IArguments, 
        returnValue: {}, 
        outputProcessor: null 
      });
      
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
        message: 'OK'
      });
    });

    it('should not change status if already set', () => {
      mockSpan.status.code = SpanStatusCode.ERROR;
      
      spanHandler.postProcessSpan({ 
        span: mockSpan, 
        instance: {}, 
        args: {} as IArguments, 
        returnValue: {}, 
        outputProcessor: null 
      });
      
      expect(mockSpan.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('processSpan', () => {
    it('should set span.type to generic if no outputProcessor', () => {
      spanHandler.processSpan({ 
        span: mockSpan, 
        instance: {}, 
        args: {} as IArguments, 
        returnValue: {}, 
        outputProcessor: null,
        wrappedPackage: '' 
      });
      
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('span.type', 'generic');
    });

    it('should process span with outputProcessor if available', () => {
      const mockAccessor = vi.fn().mockReturnValue('test-value');
      const outputProcessor = [{
        type: 'inference',
        attributes: [
          [
            {
              attribute: 'name',
              accessor: mockAccessor
            }
          ]
        ]
      }];
      
      spanHandler.processSpan({ 
        span: mockSpan, 
        instance: {}, 
        args: {} as IArguments, 
        returnValue: {}, 
        outputProcessor,
        wrappedPackage: '' 
      });
      
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('span.type', 'inference');
    //   expect(mockSpan.setAttribute).toHaveBeenCalledWith('entity.1.name', 'test-value');
    //   expect(mockSpan.setAttribute).toHaveBeenCalledWith('entity.count', 1);
    });

    it('should process span events if defined in outputProcessor', () => {
      const mockAccessor = vi.fn().mockReturnValue({ test_key: 'test_value' });
      const outputProcessor = [{
        type: 'inference',
        events: [
          {
            name: 'test-event',
            attributes: [
              {
                accessor: mockAccessor
              }
            ]
          }
        ]
      }];
      
      spanHandler.processSpan({ 
        span: mockSpan, 
        instance: {}, 
        args: {} as IArguments, 
        returnValue: {}, 
        outputProcessor,
        wrappedPackage: '' 
      });
      
      expect(mockSpan.addEvent).toHaveBeenCalledWith('test-event', { test_key: 'test_value' });
    });
  });
});

describe('NonFrameworkSpanHandler', () => {
  let spanHandler: NonFrameworkSpanHandler;

  beforeEach(() => {
    spanHandler = new NonFrameworkSpanHandler();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('skipProcessor', () => {
    it('should return true if active workflow type is from WORKFLOW_TYPE_MAP', () => {
      vi.spyOn(context, 'active').mockReturnValue({ 
        getValue: vi.fn().mockReturnValue('workflow.langchain') 
      } as any);
      
      expect(spanHandler.skipProcessor({} as any)).toBe(true);
    });

    it('should return false if active workflow type is not from WORKFLOW_TYPE_MAP', () => {
      vi.spyOn(context, 'active').mockReturnValue({ 
        getValue: vi.fn().mockReturnValue('workflow.custom') 
      } as any);
      
      expect(spanHandler.skipProcessor({} as any)).toBe(false);
    });

    it('should return false if no active workflow type', () => {
      vi.spyOn(context, 'active').mockReturnValue({ 
        getValue: vi.fn().mockReturnValue(null) 
      } as any);
      
      expect(spanHandler.skipProcessor({} as any)).toBe(false);
    });
  });
});

describe('attachWorkflowType', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should set workflow type to GENERIC if no element provided', () => {
    const mockSetValue = vi.fn().mockReturnThis();
    vi.spyOn(context, 'active').mockReturnValue({ 
      getValue: vi.fn().mockReturnValue(null),
      setValue: mockSetValue
    } as any);
    
    attachWorkflowType();
    
    expect(mockSetValue).toHaveBeenCalledWith(WORKFLOW_TYPE_KEY_SYMBOL, WORKFLOW_TYPE_GENERIC);
  });

  it('should set workflow type based on package if current type is GENERIC', () => {
    const mockSetValue = vi.fn().mockReturnThis();
    vi.spyOn(context, 'active').mockReturnValue({ 
      getValue: vi.fn().mockReturnValue(WORKFLOW_TYPE_GENERIC),
      setValue: mockSetValue
    } as any);
    
    attachWorkflowType({ package: 'langchain' } as WrapperArguments);
    
    expect(mockSetValue).toHaveBeenCalledWith(WORKFLOW_TYPE_KEY_SYMBOL, 'workflow.langchain');
  });

  it('should not change workflow type if already set to non-GENERIC', () => {
    const mockSetValue = vi.fn().mockReturnThis();
    vi.spyOn(context, 'active').mockReturnValue({ 
      getValue: vi.fn().mockReturnValue('workflow.langchain'),
      setValue: mockSetValue
    } as any);
    
    attachWorkflowType({ package: 'llamaindex' } as WrapperArguments);
    
    expect(mockSetValue).not.toHaveBeenCalled();
  });
});
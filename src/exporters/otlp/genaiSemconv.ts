// Maps Monocle span attributes to OpenTelemetry gen_ai.* semantic conventions.
import { Attributes, AttributeValue } from '@opentelemetry/api';
import { ReadableSpan } from '@opentelemetry/sdk-trace-node';
import { SPAN_TYPES } from '../../instrumentation/common/constants';

const OPERATION_BY_SPAN_TYPE: Record<string, string> = {
    [SPAN_TYPES.AGENTIC_TOOL_INVOCATION]: 'execute_tool',
    [SPAN_TYPES.AGENTIC_MCP_INVOCATION]: 'execute_tool',
    [SPAN_TYPES.AGENTIC_INVOCATION]: 'invoke_agent',
    [SPAN_TYPES.AGENTIC_REQUEST]: 'invoke_agent',
    [SPAN_TYPES.RETRIEVAL]: 'retrieval',
};

// Every entity index present, plus 1..entity.count.
function entityIndices(attributes: Attributes): number[] {
    const indices = new Set<number>();
    for (const key of Object.keys(attributes)) {
        const match = /^entity\.(\d+)\./.exec(key);
        if (match) {
            indices.add(Number(match[1]));
        }
    }
    const entityCount = attributes['entity.count'];
    if (typeof entityCount === 'number' && Number.isInteger(entityCount)) {
        for (let index = 1; index <= entityCount; index++) {
            indices.add(index);
        }
    }
    return [...indices].sort((a, b) => a - b);
}

function findEntityName(attributes: Attributes, typePrefixes: string[]): string | undefined {
    for (const index of entityIndices(attributes)) {
        const entityType = attributes[`entity.${index}.type`];
        if (typeof entityType !== 'string' || !typePrefixes.some((prefix) => entityType.startsWith(prefix))) {
            continue;
        }
        const entityName = attributes[`entity.${index}.name`];
        if (entityName != null) {
            return String(entityName);
        }
    }
    return undefined;
}

function operationForSpan(attributes: Attributes): string | undefined {
    const spanType = attributes['span.type'];
    if (typeof spanType !== 'string') {
        return undefined;
    }
    if (OPERATION_BY_SPAN_TYPE[spanType]) {
        return OPERATION_BY_SPAN_TYPE[spanType];
    }
    if (spanType === 'embedding' || spanType.startsWith('embedding.')) {
        return 'embeddings';
    }
    if (spanType === SPAN_TYPES.INFERENCE || spanType === SPAN_TYPES.INFERENCE_FRAMEWORK) {
        return findEntityName(attributes, ['model.embedding']) !== undefined ? 'embeddings' : 'chat';
    }
    return undefined;
}

function metadataValue(span: ReadableSpan, ...names: string[]): AttributeValue | undefined {
    for (const event of span.events || []) {
        if (event.name !== 'metadata') {
            continue;
        }
        for (const name of names) {
            const value = event.attributes?.[name];
            if (value != null) {
                return value;
            }
        }
    }
    return undefined;
}

// Returns the gen_ai.* attributes the span is missing; never overrides existing ones.
export function getGenaiAttributes(span: ReadableSpan): Attributes {
    const attributes = span.attributes || {};
    const operation = operationForSpan(attributes);
    if (!operation) {
        return {};
    }

    const added: Attributes = {};
    const addIfMissing = (key: string, value: AttributeValue | undefined) => {
        if (value != null && !(key in attributes)) {
            added[key] = value;
        }
    };

    addIfMissing('gen_ai.operation.name', operation);
    addIfMissing('gen_ai.workflow.name', attributes['workflow.name']);

    const providerIndex = entityIndices(attributes).find(
        (index) => attributes[`entity.${index}.provider_name`] != null
    );
    if (providerIndex !== undefined) {
        addIfMissing('gen_ai.provider.name', attributes[`entity.${providerIndex}.provider_name`]);
    }
    const modelPrefixes = operation === 'embeddings' ? ['model.embedding'] : ['model.llm'];
    addIfMissing('gen_ai.request.model', findEntityName(attributes, modelPrefixes));

    addIfMissing('gen_ai.usage.input_tokens', metadataValue(span, 'prompt_tokens', 'input_tokens'));
    addIfMissing('gen_ai.usage.output_tokens', metadataValue(span, 'completion_tokens', 'output_tokens'));

    if (operation === 'execute_tool') {
        addIfMissing('gen_ai.tool.name', findEntityName(attributes, ['tool']));
    } else if (operation === 'invoke_agent') {
        addIfMissing('gen_ai.agent.name', findEntityName(attributes, ['agent.', 'agentic.']));
    }
    return added;
}

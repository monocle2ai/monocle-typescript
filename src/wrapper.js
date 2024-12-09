const isRootSpan = function (span) {
    if (typeof span.parentSpanId === "string" && span.parentSpanId.length > 0)
        return false
    return true;
};

const preProcessSpan = function ({ span, instance, args, wrapperConfig, outputProcessor }) {
    const sdkVersion = "0.0.1"
    span.setAttribute("okahu-observability.version", sdkVersion)

    if (outputProcessor) {
        outputProcessor(
            {
                returnValue: undefined,
                arguments: args,
                classInstance: instance,
                span
            })
    }
}

const postProcessSpan = function ({ span, instance, args, wrapperConfig, returnValue, outputProcessor }) {

    if (typeof outputProcessor === "function") {
        outputProcessor(
            {
                returnValue,
                args,
                classInstance: instance,
                span
            })
    }
}

const getPatchedMain = function ({ tracer, ...element }) {
    return function mainMethodName(original) {
        return function patchMainMethodName() {
            return tracer.startActiveSpan(
                element.spanName || element.package || '' + element.object || '' + element.method || '',
                async (span) => {
                    console.log("startActiveSpan")
                    preProcessSpan({ span: span, instance: this, args: arguments, wrapperConfig: element })
                    // processSpan({span, instance: this, args: arguments, outputProcessor})
                    const returnValue = await original.apply(this, arguments);
                    postProcessSpan({ span, instance: this, args: arguments, wrapperConfig: element, returnValue })
                    processSpan({ span, instance: this, args: arguments, outputProcessor: element.output_processor, returnValue, package: element.package })
                    span.end()
                    return returnValue
                }
            );

        };
    };
}

const WORKFLOW_TYPE_MAP = {
    "llamaindex": "workflow.llamaindex",
    "langchain": "workflow.langchain",
    "haystack": "workflow.haystack"
}

function getWorkflowName(span) {
    try {
        return span.resource.attributes["SERVICE_NAME"];
    } catch (e) {
        console.error(`Error getting workflow name: ${e}`);
        return `workflow.${span.context.traceId}`;
    }
}

function setWorkflowAttributes({ package, span, spanIndex }) {
    let returnValue = 1;
    let workflowName = getWorkflowName(span);
    if (workflowName) {
        span.setAttribute("span.type", "workflow");
        span.setAttribute(`entity.${spanIndex}.name`, workflowName);
        // workflow type
    }
    let workflowTypeSet = false;
    for (let [packageName, workflowType] of Object.entries(WORKFLOW_TYPE_MAP)) {
        if (package !== undefined && package.includes(packageName)) {
            span.setAttribute(`entity.${spanIndex}.type`, workflowType);
            workflowTypeSet = true;
        }
    }
    if (!workflowTypeSet) {
        span.setAttribute(`entity.${spanIndex}.type`, "workflow.generic");
    }
    return returnValue;
}



function processSpan({ span, instance, args, returnValue, outputProcessor, package }) {
    let spanIndex = 1;

    if (isRootSpan(span)) {
        spanIndex += setWorkflowAttributes({ package, span, spanIndex });
        // spanIndex += setAppHostingIdentifierAttribute(span, spanIndex);
    }

    if (outputProcessor && outputProcessor[0]) {
        outputProcessor = outputProcessor[0];
        if (typeof outputProcessor === 'object' && Object.keys(outputProcessor).length > 0) {
            if (outputProcessor.type) {
                span.setAttribute("span.type", outputProcessor.type);
            } else {
                console.warn("type of span not found or incorrect written in entity json");
            }

            if (outputProcessor.attributes) {
                spanIndex = 1;

                outputProcessor.attributes.forEach((processors) => {
                    let attributeSet = false;
                    processors.forEach((processor) => {
                        const attribute = processor['attribute'];
                        const accessor = processor['accessor'];

                        if (attribute && accessor) {
                            const attributeName = `entity.${spanIndex}.${attribute}`;
                            try {
                                const accessor_args = { instance: instance, args: args, output: returnValue };
                                if (typeof accessor === 'function') {
                                    const result = accessor(accessor_args);
                                    if (result && typeof result === 'string') {
                                        attributeSet = true;
                                        span.setAttribute(attributeName, result);
                                    }
                                }

                            } catch (e) {
                                console.error(`Error processing accessor: ${e}`);
                            }
                        } else {
                            console.warn(`${['attribute', 'accessor'].filter(key => !processor[key]).join(' and ')} not found or incorrect in entity JSON`);
                        }
                    });
                    attributeSet && spanIndex++;
                });
            } else {
                console.warn("attributes not found or incorrect written in entity json");
            }
            if (spanIndex > 0) {
                span.setAttribute("entity.count", spanIndex - 1);
            }

            if (outputProcessor.events) {
                const events = outputProcessor.events;
                const accessorMapping = {
                    "args": args,
                    "response": returnValue,
                    "instance": instance
                };

                events.forEach((event) => {
                    const eventName = event.name;
                    const eventAttributes = {};
                    const attributes = event.attributes || [];

                    attributes.forEach((attribute) => {
                        const attributeKey = attribute.attribute;
                        const accessor = attribute.accessor;

                        if (typeof accessor === 'function') {
                            try {
                                const accessorFunction = accessor;
                                const accessorResponse = accessorFunction(accessorMapping);
                                if (accessorResponse && typeof accessorResponse === 'string' && accessorResponse.length > 0) {
                                    eventAttributes[attributeKey] = accessorResponse;
                                }
                                // for (const [keyword, value] of Object.entries(accessorMapping)) {
                                //     if (accessor.includes(keyword)) {
                                //         eventAttributes[attributeKey] = accessorFunction(value);
                                //     }
                                // }
                            } catch (e) {
                                console.error(`Error evaluating accessor for attribute '${attributeKey}': ${e}`);
                            }
                        }
                    });

                    span.addEvent(eventName, eventAttributes);
                });
            }
        } else {
            console.warn("empty or entities json is not in correct format");
        }
    }
}

exports.getPatchedMain = getPatchedMain
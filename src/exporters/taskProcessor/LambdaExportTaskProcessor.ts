import axios from 'axios';
// import * as AWS from 'aws-sdk';
import { consoleLog } from '../../common/logging';

const LAMBDA_EXTENSION_NAME = "AsyncProcessorMonocle";

type AsyncTask = (args: any) => any;
type QueueItem = [AsyncTask | null, any];

// interface Span {
//     attributes: Record<string, any>;
//     parent_id?: string;
// }

export abstract class ExportTaskProcessor {
    abstract start(): void;
    abstract stop(): void;
    abstract enabled: boolean;
    abstract queueTask(asyncTask?: (args: any) => any, args?: any): void;
}

export class LambdaExportTaskProcessor extends ExportTaskProcessor {
    enabled: boolean;
    private asyncTasksQueue: QueueItem[];
    private spanCheckInterval: number;
    private maxTimeAllowed: number;

    constructor(
        spanCheckIntervalSeconds: number = 1,
        maxTimeAllowedSeconds: number = 30
    ) {
        super();
        this.asyncTasksQueue = [];
        this.spanCheckInterval = spanCheckIntervalSeconds;
        this.maxTimeAllowed = maxTimeAllowedSeconds;
        this.enabled = false;
    }

    public start(): void {
        try {
            consoleLog(`LambdaExportTaskProcessor| Starting...`);
            this.startAsyncProcessor();
        } catch (e) {
            this.enabled = false;
            consoleLog(`LambdaExportTaskProcessor| Failed to start. ${e}`);
        }
    }

    public stop(): void {
        // Implementation left empty as in Python
    }

    public queueTask(asyncTask: AsyncTask | null = null, args: any = null): void {
        if (!this.enabled) {
            consoleLog(`LambdaExportTaskProcessor| Task processor is not enabled. Ignoring task.`);
            asyncTask(args);
            return;
        }
        this.asyncTasksQueue.push([asyncTask, args]);
    }

    // private setSagemakerModel(endpointName: string, span: Span): void {
    //     try {
    //         const sageMaker = new AWS.SageMaker();
            
    //         sageMaker.describeEndpoint({ EndpointName: endpointName }, (err, endpointData) => {
    //             if (err) {
    //                 consoleLog(`LambdaExportTaskProcessor| Failed to describe endpoint: ${err}`);
    //                 return;
    //             }
                
    //             const endpointConfigName = endpointData.EndpointConfigName;
                
    //             sageMaker.describeEndpointConfig({ EndpointConfigName: endpointConfigName! }, (err, configData) => {
    //                 if (err) {
    //                     consoleLog(`LambdaExportTaskProcessor| Failed to describe endpoint config: ${err}`);
    //                     return;
    //                 }
                    
    //                 const modelName = configData.ProductionVariants?.[0]?.ModelName;
                    
    //                 if (!modelName) {
    //                     return;
    //                 }
                    
    //                 sageMaker.describeModel({ ModelName: modelName }, (err, modelData) => {
    //                     if (err) {
    //                         consoleLog(`LambdaExportTaskProcessor| Failed to describe model: ${err}`);
    //                         return;
    //                     }
                        
    //                     let modelNameId = "";
    //                     try {
    //                         modelNameId = modelData.PrimaryContainer?.Environment?.HF_MODEL_ID || "";
    //                     } catch (e) {
    //                         // Ignore errors
    //                     }
                        
    //                     span.attributes["model_name"] = modelNameId;
    //                 });
    //             });
    //         });
    //     } catch (e) {
    //         consoleLog(`LambdaExportTaskProcessor| Failed to get sagemaker model. ${e}`);
    //     }
    // }

    // private updateSpans(exportArgs: any): void {
    //     try {
    //         if ('batch' in exportArgs) {
    //             for (const span of exportArgs.batch) {
    //                 try {
    //                     if (span.attributes.sagemaker_endpoint_name?.length > 0) {
    //                         this.setSagemakerModel(span.attributes.sagemaker_endpoint_name, span);
    //                     }
    //                 } catch {
    //                     // Ignore errors
    //                 }
    //             }
    //         }
    //     } catch (e) {
    //         consoleLog(`LambdaExportTaskProcessor| Failed to update spans. ${e}`);
    //     }
    // }

    private startAsyncProcessor(): void {
        consoleLog(`[${LAMBDA_EXTENSION_NAME}] Registering with Lambda service...`);
        consoleLog(`[${LAMBDA_EXTENSION_NAME}] AWS_LAMBDA_RUNTIME_API: ${process.env.AWS_LAMBDA_RUNTIME_API}`);
        axios.post(
            `http://${process.env.AWS_LAMBDA_RUNTIME_API}/2020-01-01/extension/register`,
            { events: ['INVOKE'] },
            { headers: { 'Lambda-Extension-Name': LAMBDA_EXTENSION_NAME } }
        ).then(response => {
            const extId = response.headers['lambda-extension-identifier'];
            consoleLog(`[${LAMBDA_EXTENSION_NAME}] Registered with ID: ${extId}`);
            this.enabled = true;
            consoleLog(`[${LAMBDA_EXTENSION_NAME}] Starting async task processor...`);
            const processTasksAsync = async () => {
                while (true) {
                    consoleLog(`[${LAMBDA_EXTENSION_NAME}] Waiting for invocation...`);
                    
                    const response = await axios.get(
                        `http://${process.env.AWS_LAMBDA_RUNTIME_API}/2020-01-01/extension/event/next`,
                        { headers: { 'Lambda-Extension-Identifier': extId } }
                    );
                    
                    let rootSpanFound = false;
                    let totalTimeElapsed = 0;
                    
                    while (!rootSpanFound && totalTimeElapsed < this.maxTimeAllowed) {
                        consoleLog(JSON.stringify(response.data));
                        consoleLog(`[${LAMBDA_EXTENSION_NAME}] Async thread running, waiting for task from handler`);
                        
                        while (this.asyncTasksQueue.length > 0) {
                            const [asyncTask, args] = this.asyncTasksQueue.shift() as QueueItem;
                            
                            // Check if root span task is present in queue
                            if (args instanceof Array) {
                                for (const span of args) {
                                    if (span?.parentSpanContext?.spanId === "None" || !span?.parentSpanContext?.spanId) {
                                        consoleLog(`[${LAMBDA_EXTENSION_NAME}] Found root span in task queue: name: ${span.name}.`);
                                        rootSpanFound = true;
                                    }
                                }
                            }
                            
                            // this.updateSpans(args);
                            
                            if (asyncTask === null) {
                                consoleLog(`[${LAMBDA_EXTENSION_NAME}] Received null task. Ignoring.`);
                            } else {
                                consoleLog(`[${LAMBDA_EXTENSION_NAME}] Received async task from handler. Starting task.`);
                                const return_val = asyncTask(args);
                                if(typeof return_val === 'object' && 'then' in return_val) {
                                    await return_val;
                                }
                            }
                        }
                        
                        totalTimeElapsed += this.spanCheckInterval;
                        await new Promise(resolve => setTimeout(resolve, this.spanCheckInterval * 1000));
                    }
                    
                    consoleLog(`[${LAMBDA_EXTENSION_NAME}] Finished processing task. total_time_elapsed: ${totalTimeElapsed}, root_span_found: ${rootSpanFound}.`);
                }
            };
            
            processTasksAsync().catch(err => {
                consoleLog(`[${LAMBDA_EXTENSION_NAME}] Error in async task processor: ${err}`);
            });
        }).catch(error => {
            this.enabled = false;
            consoleLog(`[${LAMBDA_EXTENSION_NAME}] Failed to register extension: ${error}`);
            if (error.response) {
                consoleLog(`[${LAMBDA_EXTENSION_NAME}] Response data: ${JSON.stringify(error.response.data)}`);
                consoleLog(`[${LAMBDA_EXTENSION_NAME}] Response status: ${error.response.status}`);
            }
        });
    }
}

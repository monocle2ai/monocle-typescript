import { FileSpanExporter } from './file/FileSpanExporter';
import { MonocleConsoleSpanExporter } from './monocle/MonocleConsoleSpanExporter';
import { OkahuSpanExporter } from './okahu/OkahuSpanExporter';
import { AWSS3SpanExporter } from './aws/AWSS3SpanExporter';
import { AzureBlobSpanExporter } from './azure/AzureBlobSpanExporter'
import { consoleLog } from '../common/logging';
import { ExportTaskProcessor, isAwsLambdaEnvironment, LambdaExportTaskProcessor } from './taskProcessor';

interface GetMonocleExportersOptions {
    taskProcessor?: ExportTaskProcessor;
}

const monocleExporters = {
    "s3": (options: GetMonocleExportersOptions = {}) => new AWSS3SpanExporter({ taskProcessor: options.taskProcessor }),
    "blob": (options: GetMonocleExportersOptions = {}) => new AzureBlobSpanExporter({ taskProcessor: options.taskProcessor }),
    "okahu": (options: GetMonocleExportersOptions = {}) => new OkahuSpanExporter({ taskProcessor: options.taskProcessor }),
    "file": (options: GetMonocleExportersOptions = {}) => new FileSpanExporter({ taskProcessor: options.taskProcessor }),
    "console": (options: GetMonocleExportersOptions = {}) => new MonocleConsoleSpanExporter({ taskProcessor: options.taskProcessor }),
};

function getMonocleExporters(options: GetMonocleExportersOptions = {}) {
    const getMonocleExporterOptions = options || {};
    if (isAwsLambdaEnvironment() && !getMonocleExporterOptions.taskProcessor) {
        consoleLog('getMonocleExporters| Using LambdaExportTaskProcessor for AWS Lambda environment');
        getMonocleExporterOptions.taskProcessor = new LambdaExportTaskProcessor();
    }
    const exporterNameList = (process.env.MONOCLE_EXPORTER || 'console').split(',');
    consoleLog(`getMonocleExporters| Initializing exporters with config: ${exporterNameList}`);

    let exporters = [];
    let defaultConsoleExporterAdded = false;
    for (let exporterName of exporterNameList) {
        exporterName = exporterName.trim();
        try {
            consoleLog(`getMonocleExporters| Attempting to initialize exporter: ${exporterName}`);
            let exporter = monocleExporters[exporterName](getMonocleExporterOptions);
            
            if (exporter) {
                consoleLog(`getMonocleExporters| Successfully initialized exporter: ${exporter.constructor.name}`);
                exporters.push(exporter);
                continue;
            }
        } catch (ex) {
            consoleLog(`getMonocleExporters| Error initializing exporter ${exporterName}: ${ex.message}`);
            console.warn(`Unsupported Monocle span exporter setting ${exporterName}, using default ConsoleSpanExporter.`);
            if (!defaultConsoleExporterAdded) {
                exporters.push(new MonocleConsoleSpanExporter(options));
                defaultConsoleExporterAdded = true;
            }
        }
    }

    consoleLog(`getMonocleExporters| Final number of initialized exporters: ${exporters.length}`);
    return exporters;
}

export { getMonocleExporters };
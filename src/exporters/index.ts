import { FileSpanExporter } from './file/FileSpanExporter';
import { MonocleConsoleSpanExporter } from './monocle/MonocleConsoleSpanExporter';
import { OkahuSpanExporter } from './okahu/OkahuSpanExporter';
import { AWSS3SpanExporter } from './aws/AWSS3SpanExporter';
import { AzureBlobSpanExporter } from './azure/AzureBlobSpanExporter'
import { consoleLog } from '../common/logging';



const monocleExporters = {
    "s3": () => new AWSS3SpanExporter({}),
    "blob": () => new AzureBlobSpanExporter({}),
    "okahu": () => new OkahuSpanExporter({}),
    "file": () => new FileSpanExporter({}),
    "console": () => new MonocleConsoleSpanExporter(),
};

function getMonocleExporters() {
    const exporterNameList = (process.env.MONOCLE_EXPORTER || 'console').split(',');
    consoleLog(`getMonocleExporters| Initializing exporters with config: ${exporterNameList}`);

    let exporters = [];
    let defaultConsoleExporterAdded = false;
    for (let exporterName of exporterNameList) {
        exporterName = exporterName.trim();
        try {
            consoleLog(`getMonocleExporters| Attempting to initialize exporter: ${exporterName}`);
            let exporter = monocleExporters[exporterName]();
            
            if (exporter) {
                consoleLog(`getMonocleExporters| Successfully initialized exporter: ${exporter.constructor.name}`);
                exporters.push(exporter);
                continue;
            }
        } catch (ex) {
            consoleLog(`getMonocleExporters| Error initializing exporter ${exporterName}: ${ex.message}`);
            console.warn(`Unsupported Monocle span exporter setting ${exporterName}, using default ConsoleSpanExporter.`);
            if (!defaultConsoleExporterAdded) {
                exporters.push(new MonocleConsoleSpanExporter());
                defaultConsoleExporterAdded = true;
            }
        }
    }

    consoleLog(`getMonocleExporters| Final number of initialized exporters: ${exporters.length}`);
    return exporters;
}

export { getMonocleExporters };
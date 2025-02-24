import { FileSpanExporter } from './file/FileSpanExporter';
import { MonocleConsoleSpanExporter } from './monocle/MonocleConsoleSpanExporter';
import { OkahuSpanExporter } from './okahu/OkahuSpanExporter';
import { AWSS3SpanExporter } from './aws/AWSS3SpanExporter';
import { AzureBlobSpanExporter } from './azure/AzureBlobSpanExporter'



const monocleExporters = {
    "s3": () => new AWSS3SpanExporter({}),
    "blob": () => new AzureBlobSpanExporter({}),
    "okahu": () => new OkahuSpanExporter({}),
    "file": () => new FileSpanExporter({}),
    "console": () => new MonocleConsoleSpanExporter(),
};

function getMonocleExporters() {
    const exporterNameList = (process.env.MONOCLE_EXPORTER || 'console').split(',');

    let exporters = [];
    let defaultConsoleExporterAdded = false;
    for (let exporterName of exporterNameList) {
        exporterName = exporterName.trim();
        try {
            let exporter = monocleExporters[exporterName]();
            if (exporter) {
                exporters.push(exporter);
                continue;
            }
        } catch (ex) {
            console.warn(`Unsupported Monocle span exporter setting ${exporterName}, using default ConsoleSpanExporter.`);
            if (!defaultConsoleExporterAdded) {
                exporters.push(new MonocleConsoleSpanExporter());
                defaultConsoleExporterAdded = true;
            }

        }
    }

    return exporters;
}

export { getMonocleExporters };
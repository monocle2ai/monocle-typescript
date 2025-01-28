import { FileSpanExporter } from './file/FileSpanExporter';
import { MonocleConsoleSpanExporter } from './monocle/MonocleConsoleSpanExporter';
const monocleExporters = {
    "s3": () => new (require('./aws/AWSS3SpanExporter').AWSS3SpanExporter)({}),
    "blob": () => new (require('./azure/AzureBlobSpanExporter').AzureBlobSpanExporter)({}),
    "file": () => new FileSpanExporter({}),
    "console": () => new MonocleConsoleSpanExporter(),
};

function getMonocleExporter() {
    const exporterName = process.env.MONOCLE_EXPORTER || 'console';
    let exporter;

    try {
        exporter = monocleExporters[exporterName]();
    } catch (ex) {
        console.warn(`Unsupported Monocle span exporter setting ${exporterName}, using default ConsoleSpanExporter.`);
        return new MonocleConsoleSpanExporter();
    }

    return exporter;
}

export { getMonocleExporter };
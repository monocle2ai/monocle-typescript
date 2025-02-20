import { FileSpanExporter } from './file/FileSpanExporter';
import { MonocleConsoleSpanExporter } from './monocle/MonocleConsoleSpanExporter';
import { OkahuSpanExporter } from './okahu/OkahuSpanExporter';

const monocleExporters = {
    "s3": () => new (require('./aws/AWSS3SpanExporter').AWSS3SpanExporter)({}),
    "blob": () => new (require('./azure/AzureBlobSpanExporter').AzureBlobSpanExporter)({}),
    "okahu": () => new OkahuSpanExporter({}),
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
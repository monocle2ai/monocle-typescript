import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMonocleExporters } from '../../src/exporters';
import { MonocleConsoleSpanExporter } from '../../src/exporters/monocle/MonocleConsoleSpanExporter';
import { FileSpanExporter } from '../../src/exporters/file/FileSpanExporter';
import { OkahuSpanExporter } from '../../src/exporters/okahu/OkahuSpanExporter';
import { AWSS3SpanExporter } from '../../src/exporters/aws/AWSS3SpanExporter';
import { AzureBlobSpanExporter } from '../../src/exporters/azure/AzureBlobSpanExporter';

describe('getMonocleExporters', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        // Set required environment variables for different exporters
        process.env.OKAHU_API_KEY = 'test-key';
        process.env.MONOCLE_BLOB_CONNECTION_STRING = 'test-connection-string';
        process.env.AWS_REGION = 'us-east-1';
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should return console exporter by default when no MONOCLE_EXPORTER is set', () => {
        delete process.env.MONOCLE_EXPORTER;
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(1);
        expect(exporters[0]).toBeInstanceOf(MonocleConsoleSpanExporter);
    });

    it('should return console exporter when MONOCLE_EXPORTER=console', () => {
        process.env.MONOCLE_EXPORTER = 'console';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(1);
        expect(exporters[0]).toBeInstanceOf(MonocleConsoleSpanExporter);
    });

    it('should return file exporter when MONOCLE_EXPORTER=file', () => {
        process.env.MONOCLE_EXPORTER = 'file';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(1);
        expect(exporters[0]).toBeInstanceOf(FileSpanExporter);
    });

    it('should return okahu exporter when MONOCLE_EXPORTER=okahu', () => {
        process.env.MONOCLE_EXPORTER = 'okahu';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(1);
        expect(exporters[0]).toBeInstanceOf(OkahuSpanExporter);
    });

    it('should return s3 exporter when MONOCLE_EXPORTER=s3', () => {
        process.env.MONOCLE_EXPORTER = 's3';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(1);
        expect(exporters[0]).toBeInstanceOf(AWSS3SpanExporter);
    });

    it('should return blob exporter when MONOCLE_EXPORTER=blob', () => {
        process.env.MONOCLE_EXPORTER = 'blob';
        process.env.MONOCLE_BLOB_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=mykey123;EndpointSuffix=core.windows.net';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(1);
        expect(exporters[0]).toBeInstanceOf(AzureBlobSpanExporter);
    });

    it('should return multiple exporters when MONOCLE_EXPORTER contains comma-separated values', () => {
        process.env.MONOCLE_EXPORTER = 'console,file,okahu';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(3);
        expect(exporters[0]).toBeInstanceOf(MonocleConsoleSpanExporter);
        expect(exporters[1]).toBeInstanceOf(FileSpanExporter);
        expect(exporters[2]).toBeInstanceOf(OkahuSpanExporter);
    });

    it('should handle spaces in comma-separated values', () => {
        process.env.MONOCLE_EXPORTER = 'console, file, okahu';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(3);
        expect(exporters[0]).toBeInstanceOf(MonocleConsoleSpanExporter);
        expect(exporters[1]).toBeInstanceOf(FileSpanExporter);
        expect(exporters[2]).toBeInstanceOf(OkahuSpanExporter);
    });

    it('should return console exporter when invalid exporter is specified', () => {
        process.env.MONOCLE_EXPORTER = 'invalid';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(1);
        expect(exporters[0]).toBeInstanceOf(MonocleConsoleSpanExporter);
    });

    it('should handle mix of valid and invalid exporters', () => {
        process.env.MONOCLE_EXPORTER = 'console,invalid,file';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(3);
        expect(exporters[0]).toBeInstanceOf(MonocleConsoleSpanExporter);
        expect(exporters[1]).toBeInstanceOf(MonocleConsoleSpanExporter);
        expect(exporters[2]).toBeInstanceOf(FileSpanExporter);
    });
});

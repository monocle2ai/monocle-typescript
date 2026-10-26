import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { getMonocleExporters } from '../../src/exporters';
import { GenaiSemconvSpanExporter } from '../../src/exporters/otlp/GenaiSemconvSpanExporter';
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

    it('should return multiple exporters when contains comma-separated values as argument', () => {
        process.env.MONOCLE_EXPORTER = 'console,file';
        const exporters = getMonocleExporters('console,file,okahu');
        expect(exporters).toHaveLength(3);
        expect(exporters[0]).toBeInstanceOf(MonocleConsoleSpanExporter);
        expect(exporters[1]).toBeInstanceOf(FileSpanExporter);
        expect(exporters[2]).toBeInstanceOf(OkahuSpanExporter);
    });

    it('should return OTLP exporter when MONOCLE_EXPORTER=otlp', () => {
        process.env.MONOCLE_EXPORTER = 'otlp';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(1);
        expect(exporters[0]).toBeInstanceOf(OTLPTraceExporter);
    });

    it('should return GenAI semconv exporter when MONOCLE_EXPORTER=otlp-genai-semconv', () => {
        process.env.MONOCLE_EXPORTER = 'otlp-genai-semconv';
        const exporters = getMonocleExporters();
        expect(exporters).toHaveLength(1);
        expect(exporters[0]).toBeInstanceOf(GenaiSemconvSpanExporter);
    });
});

describe('OTLP exporters against a live endpoint', () => {
    const originalEnv = process.env;
    let server: http.Server;
    let received: { url?: string; headers?: http.IncomingHttpHeaders; body?: any };

    beforeEach(async () => {
        received = {};
        server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                received = { url: req.url, headers: req.headers, body: JSON.parse(body) };
                res.writeHead(200).end();
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        process.env = { ...originalEnv };
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${port}/v1/traces`;
        process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = 'Authorization=Bearer%20test-token,X-Tenant-ID=test-tenant';
    });

    afterEach(async () => {
        process.env = originalEnv;
        await new Promise((resolve) => server.close(resolve));
    });

    function inferenceSpan() {
        const memory = new InMemorySpanExporter();
        const tracer = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memory)] }).getTracer('test');
        const span = tracer.startSpan('inference');
        span.setAttributes({
            'span.type': 'inference',
            'entity.2.name': 'gemini-2.5-flash',
            'entity.2.type': 'model.llm.gemini-2.5-flash',
        });
        span.end();
        return memory.getFinishedSpans()[0];
    }

    async function exportWith(exporterName: string, span: any) {
        const [exporter] = getMonocleExporters(exporterName);
        const result = await new Promise<any>((resolve) => exporter.export([span], resolve));
        await exporter.shutdown();
        expect(result.code).toBe(0);
        const sent = received.body.resourceSpans[0].scopeSpans[0].spans[0].attributes;
        return Object.fromEntries(sent.map((a: any) => [a.key, Object.values(a.value)[0]]));
    }

    it('sends to the configured endpoint with decoded auth headers', async () => {
        await exportWith('otlp', inferenceSpan());

        expect(received.url).toBe('/v1/traces');
        expect(received.headers?.authorization).toBe('Bearer test-token');
        expect(received.headers?.['x-tenant-id']).toBe('test-tenant');
    });

    it('otlp sends spans as they are, without gen_ai attributes', async () => {
        const sent = await exportWith('otlp', inferenceSpan());

        expect(sent['span.type']).toBe('inference');
        expect(Object.keys(sent).some((key) => key.startsWith('gen_ai.'))).toBe(false);
    });

    it('otlp-genai-semconv sends gen_ai attributes and leaves the original span untouched', async () => {
        const span = inferenceSpan();
        const before = { ...span.attributes };

        const sent = await exportWith('otlp-genai-semconv', span);

        expect(received.url).toBe('/v1/traces');
        expect(sent['span.type']).toBe('inference');
        expect(sent['gen_ai.operation.name']).toBe('chat');
        expect(sent['gen_ai.request.model']).toBe('gemini-2.5-flash');
        expect(span.attributes).toEqual(before);
    });
});

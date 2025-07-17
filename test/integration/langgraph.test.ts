import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { sortSpans, cleanSpan } from './utils/span-comparison';

describe('Langgraph Sample', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const capturedLogs: any[] = [];

    beforeEach(() => {
        consoleSpy.mockImplementation((message) => {
            try {
                capturedLogs.push(JSON.parse(message));
            }
            catch(e) {
                console.warn("Found non json message in console log: ", message);   
            }
        });
    });

    afterEach(() => {
        consoleSpy.mockReset();
        capturedLogs.length = 0;
    });

    it('should generate all expected spans', async () => {
        // Load expected NDJSON data
        const ndjsonPath = join(__dirname, '../examples/langgraphChatSample.ndjson');
        const ndjsonContent = readFileSync(ndjsonPath, 'utf-8');
        const expectedSpans = ndjsonContent
            .split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));

        // Run the sample code
        await (await import('../examples/langgraphChatSample.js')).main();

        // Wait for async operations to complete
        await new Promise(resolve => setTimeout(resolve, 5000));

        const sortedExpectedSpans = sortSpans(expectedSpans);
        const sortedCapturedLogs = sortSpans(capturedLogs);

        // Verify spans one by one in sorted order
        for (let i = 0; i < sortedExpectedSpans.length; i++) {
            const expectedSpan = sortedExpectedSpans[i];
            const actualSpan = sortedCapturedLogs[i];

            expect(actualSpan.name).toBe(expectedSpan.name);
            if (expectedSpan.parent_id) {
                expect(actualSpan.parent_id).toBeDefined();
            }
            
            const cleanedActual = cleanSpan(actualSpan);
            const cleanedExpected = cleanSpan(expectedSpan);
            
            expect(cleanedActual).toEqual(cleanedExpected);
        }

        // Verify count matches
        expect(sortedCapturedLogs.length).toBe(sortedExpectedSpans.length);
    });
});

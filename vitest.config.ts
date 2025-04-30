import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        '.eslintrc.js',
        '**/*.d.ts',
        '**/*.test.ts',
        'test/**',
        'eslint.config.mjs',
        'vitest.config.ts',
        'guide/custom_instrumentation/**',
        'scripts/utils/**',
      ],
      all: true,
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70
      }
    }
  }
});

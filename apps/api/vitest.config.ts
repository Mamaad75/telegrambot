import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.e2e.test.ts', 'node_modules/**'],
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      '@baimar/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});

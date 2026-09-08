import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * End-to-end suite. Requires a reachable PostgreSQL (DATABASE_URL) and Redis.
 * Run with: npm run test:e2e -w @baimar/api
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.e2e.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@baimar/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});

import { execSync } from 'node:child_process';

/**
 * End-to-end environment.
 *
 * Runs against a *separate* database so a test run can never touch development or
 * production data. The schema is applied with `prisma db push` before the suite starts.
 *
 * Requires a reachable PostgreSQL and Redis. Point E2E_DATABASE_URL at a throwaway
 * database; the default matches the docker-compose development stack.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://baimar:baimar@127.0.0.1:5432/baimar_test?schema=public';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.JWT_SECRET ??= 'e2e-test-secret-0123456789abcdef0123456789abcdef';
process.env.APP_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.LOG_LEVEL ??= 'silent';
process.env.RUN_WORKERS_IN_API = 'false';
process.env.QUEUE_PREFIX = 'baimar-e2e';
// Every outbound integration stays off: the suite must prove the platform works with
// nothing configured but the database and Redis.
process.env.AI_PROVIDER = 'none';
process.env.OVERPASS_ENABLED = 'false';
process.env.DOMAIN_PROBE_ENABLED = 'false';
process.env.GOOGLE_MAPS_API_KEY = '';
process.env.BRAVE_SEARCH_API_KEY = '';
process.env.TELEGRAM_BOT_TOKEN = '';

execSync('npx prisma db push --skip-generate --accept-data-loss', {
  cwd: __dirname,
  stdio: 'inherit',
  env: process.env,
});

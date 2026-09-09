import { loadEnv } from './config/env';
import { preflight } from './config/preflight';
import { prisma } from './lib/prisma';
import { syncProviders } from './providers/registry';
import { closeQueues } from './queue/queues';
import { startWorkers, stopWorkers } from './queue/worker';
import { startSchedules, stopSchedules } from './schedules';

/**
 * Dedicated worker process.
 *
 * Run this alongside the API in production so crawling and AI calls never share a CPU
 * slice with request handling.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  // The worker enforces the same configuration contract as the API: it writes to the
  // same database with the same secrets, so a weak production secret is just as fatal here.
  const config = preflight(env);
  if (!config.ok) {
    // eslint-disable-next-line no-console
    console.error(['[worker] refusing to start — invalid configuration:', ...config.fatal.map((f) => `  - ${f}`)].join('\n'));
    process.exit(1);
  }
  for (const warning of config.warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[worker] ${warning}`);
  }

  await prisma.$connect();
  await syncProviders().catch(() => undefined);

  startWorkers();
  startSchedules();

  // eslint-disable-next-line no-console
  console.log('[worker] Baimar Lead Intelligence workers started');

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[worker] ${signal} received, shutting down`);
    stopSchedules();
    await stopWorkers();
    await closeQueues();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal error:', err);
  process.exit(1);
});

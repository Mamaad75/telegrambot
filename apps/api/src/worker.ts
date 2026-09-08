import { loadEnv } from './config/env';
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
  loadEnv();
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

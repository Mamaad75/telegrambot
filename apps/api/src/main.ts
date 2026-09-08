import { loadEnv } from './config/env';
import { buildApp } from './app';
import { prisma } from './lib/prisma';
import { syncProviders } from './providers/registry';
import { closeQueues } from './queue/queues';
import { startWorkers, stopWorkers } from './queue/worker';
import { seedDefaultsIfEmpty } from './bootstrap';

/**
 * API entry point.
 *
 * On a 2 CPU / 4 GB VPS the API and the workers can share one process
 * (RUN_WORKERS_IN_API=true). Under load, run `npm run start:worker` separately and set
 * that flag to false so a long crawl never blocks an HTTP request.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp();

  try {
    await prisma.$connect();
    app.log.info('database connected');
  } catch (err) {
    app.log.error({ err }, 'could not connect to the database — check DATABASE_URL');
    process.exit(1);
  }

  // Register providers and seed the catalogue on first boot.
  await syncProviders().catch((err) => app.log.warn({ err }, 'provider sync failed'));
  await seedDefaultsIfEmpty().catch((err) => app.log.warn({ err }, 'default seed failed'));

  if (env.RUN_WORKERS_IN_API) {
    startWorkers();
    app.log.info('queue workers started in the API process');
  }

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(`Baimar Lead Intelligence API listening on ${env.API_HOST}:${env.API_PORT}`);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    try {
      await app.close();
      await stopWorkers();
      await closeQueues();
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal startup error:', err);
  process.exit(1);
});

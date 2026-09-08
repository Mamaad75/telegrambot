import { afterAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { createRedisConnection, disconnectRedis, redisHealthy } from '../lib/redis';
import { enqueue, queueHealth } from '../queue/queues';

/**
 * Queue behaviour.
 *
 * The pipeline depends on jobs being retried rather than lost: a website that times out
 * once must be audited on the next attempt, not silently dropped.
 */

const PREFIX = process.env.QUEUE_PREFIX ?? 'baimar-e2e';
const QUEUE_NAME = `retry-test-${Date.now()}`;

const created: Array<{ close: () => Promise<void> }> = [];

afterAll(async () => {
  await Promise.all(created.map((c) => c.close().catch(() => undefined)));
  await disconnectRedis();
});

describe('background jobs', () => {
  it('retries a failing job until it succeeds', async () => {
    expect(await redisHealthy()).toBe(true);

    const queue = new Queue(QUEUE_NAME, { connection: createRedisConnection(), prefix: PREFIX });
    created.push(queue);

    let attempts = 0;
    const worker = new Worker(
      QUEUE_NAME,
      async () => {
        attempts += 1;
        // Fail the first two attempts, mirroring a flaky website or provider.
        if (attempts < 3) throw new Error(`simulated failure ${attempts}`);
        return { attempts };
      },
      { connection: createRedisConnection(), prefix: PREFIX, concurrency: 1 },
    );
    created.push(worker);

    const completed = new Promise<{ attempts: number }>((resolve, reject) => {
      worker.on('completed', (_job, result) => resolve(result as { attempts: number }));
      const timer = setTimeout(() => reject(new Error('job did not complete in time')), 20000);
      worker.on('completed', () => clearTimeout(timer));
    });

    await queue.add('flaky', {}, { attempts: 3, backoff: { type: 'fixed', delay: 100 }, removeOnComplete: true });

    const result = await completed;
    expect(result.attempts).toBe(3);
  });

  it('gives up after the configured attempts instead of retrying forever', async () => {
    const name = `${QUEUE_NAME}-always-fails`;
    const queue = new Queue(name, { connection: createRedisConnection(), prefix: PREFIX });
    created.push(queue);

    let attempts = 0;
    const worker = new Worker(
      name,
      async () => {
        attempts += 1;
        throw new Error('always fails');
      },
      { connection: createRedisConnection(), prefix: PREFIX, concurrency: 1 },
    );
    created.push(worker);

    const failed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('job did not fail in time')), 20000);
      worker.on('failed', (job) => {
        if (job && job.attemptsMade >= 2) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    await queue.add('doomed', {}, { attempts: 2, backoff: { type: 'fixed', delay: 100 } });
    await failed;

    expect(attempts).toBe(2);
  });

  it('reports queue depth for the admin view', async () => {
    const health = await queueHealth();
    expect(health.length).toBeGreaterThan(0);
    for (const queue of health) {
      expect(typeof queue.waiting).toBe('number');
      expect(typeof queue.failed).toBe('number');
    }
  });

  it('enqueues a real pipeline job and returns its id', async () => {
    const jobId = await enqueue('calculate_score', { leadId: 'non-existent-lead-id' });
    expect(jobId).toBeTruthy();
  });
});

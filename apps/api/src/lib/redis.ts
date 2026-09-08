import IORedis, { type Redis } from 'ioredis';
import { loadEnv } from '../config/env';

/**
 * Redis connection.
 *
 * Deliberately lazy: the client is created on first use, not at import time. Importing a
 * module that happens to use caching must not open a socket — or require Redis to exist at
 * all — which is what lets the pure engine modules be tested and reasoned about in
 * isolation.
 */

const globalRef = globalThis as unknown as { __baimarRedis?: Redis };

function create(): Redis {
  const client = new IORedis(loadEnv().REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
  });
  client.on('error', (err) => {
    // A Redis outage degrades queues and caching but must never crash the API.
    // eslint-disable-next-line no-console
    console.error('[redis] connection error:', err.message);
  });
  return client;
}

function client(): Redis {
  if (!globalRef.__baimarRedis) globalRef.__baimarRedis = create();
  return globalRef.__baimarRedis;
}

/**
 * Proxy so `redis.get(...)` behaves exactly like a real client while deferring the
 * connection until the first command.
 */
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    const instance = client() as unknown as Record<string | symbol, unknown>;
    const value = instance[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
}) as Redis;

/** BullMQ needs its own connection; sharing one with blocking commands breaks it. */
export function createRedisConnection(): Redis {
  return new IORedis(loadEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/** Close the shared connection. Scripts must call this or the process will not exit. */
export async function disconnectRedis(): Promise<void> {
  const existing = globalRef.__baimarRedis;
  if (!existing) return;
  globalRef.__baimarRedis = undefined;
  try {
    await existing.quit();
  } catch {
    existing.disconnect();
  }
}

export async function redisHealthy(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

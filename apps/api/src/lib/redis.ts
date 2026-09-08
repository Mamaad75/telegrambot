import IORedis, { type Redis } from 'ioredis';
import { loadEnv } from '../config/env';

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

export const redis: Redis = globalRef.__baimarRedis ?? create();
if (loadEnv().NODE_ENV !== 'production') globalRef.__baimarRedis = redis;

/** BullMQ needs its own connection; sharing one with blocking commands breaks it. */
export function createRedisConnection(): Redis {
  return new IORedis(loadEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/** Close the shared connection. Scripts must call this or the process will not exit. */
export async function disconnectRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}

export async function redisHealthy(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

import { redis } from './redis';

/**
 * Small JSON cache on top of Redis. Every read path degrades gracefully:
 * a Redis outage turns the cache into a no-op instead of an error.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.floor(ttlSeconds)));
  } catch {
    /* cache is best-effort */
  }
}

export async function cacheDel(pattern: string): Promise<void> {
  try {
    if (!pattern.includes('*')) {
      await redis.del(pattern);
      return;
    }
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    /* best-effort */
  }
}

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await fn();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

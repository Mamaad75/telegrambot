import { randomUUID } from 'node:crypto';
import { redis, redisHealthy } from './redis';
import { logger } from './logger';

/**
 * Short-lived distributed locks, used to stop two workers doing the same expensive
 * thing at the same time.
 *
 * The case that motivated it: a campaign discovers two leads that turn out to share a
 * website (a chain with two branches). Both pipelines reach the audit stage within a
 * second of each other, and without a lock the crawler fetches the same twenty pages
 * twice — twice the bandwidth, twice the load on someone else's server, and two audit
 * rows that disagree because the site changed between them.
 *
 * Redis is the coordination point, never the source of truth: if Redis is unavailable
 * the lock is skipped and the work proceeds. Duplicated work is wasteful; refusing to
 * work because a cache is down would be worse.
 */

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export interface LockHandle {
  key: string;
  token: string;
  acquired: boolean;
  release: () => Promise<void>;
}

/**
 * Try to take a lock. Returns immediately — this never queues.
 *
 * `ttlSeconds` must exceed the longest the protected work can take, or a second worker
 * could start while the first is still running. It also must not be so long that a
 * crashed worker blocks the key for hours; the release is best-effort but the TTL is
 * the real guarantee.
 */
export async function acquireLock(key: string, ttlSeconds = 300): Promise<LockHandle> {
  const token = randomUUID();
  const namespaced = `lock:${key}`;

  if (!(await redisHealthy())) {
    return { key: namespaced, token, acquired: true, release: async () => undefined };
  }

  try {
    const result = await redis.set(namespaced, token, 'EX', ttlSeconds, 'NX');
    const acquired = result === 'OK';
    return {
      key: namespaced,
      token,
      acquired,
      release: async () => {
        if (!acquired) return;
        // Compare-and-delete: never release a lock that has already expired and been
        // taken by somebody else.
        await redis.eval(RELEASE_SCRIPT, 1, namespaced, token).catch(() => undefined);
      },
    };
  } catch (err) {
    logger.warn({ key, err: err instanceof Error ? err.message : String(err) }, 'lock unavailable — proceeding without it');
    return { key: namespaced, token, acquired: true, release: async () => undefined };
  }
}

/**
 * Run `fn` while holding the lock. When the lock is already held, `onBusy` decides what
 * happens — by default the call returns null and the caller treats it as "somebody else
 * is already doing this".
 */
export async function withLock<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false; result: null }> {
  const lock = await acquireLock(key, ttlSeconds);
  if (!lock.acquired) return { ran: false, result: null };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await lock.release();
  }
}

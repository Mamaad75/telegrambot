import { redis } from './redis';

export interface RateLimitWindow {
  perMinute?: number | null;
  perHour?: number | null;
  perDay?: number | null;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Which window rejected the call, when it was rejected. */
  window?: 'minute' | 'hour' | 'day';
  limit?: number;
  used?: number;
  retryAfterSeconds?: number;
}

const WINDOWS: Array<{ name: 'minute' | 'hour' | 'day'; seconds: number; key: keyof RateLimitWindow }> = [
  { name: 'minute', seconds: 60, key: 'perMinute' },
  { name: 'hour', seconds: 3600, key: 'perHour' },
  { name: 'day', seconds: 86400, key: 'perDay' },
];

/**
 * Fixed-window counters in Redis, one per provider and window.
 *
 * Deliberately conservative: if Redis is unreachable we allow the call rather than
 * stopping the whole platform, but the failure is surfaced to the caller's logs.
 */
export async function consumeRateLimit(providerKey: string, limits: RateLimitWindow): Promise<RateLimitDecision> {
  const now = Date.now();
  try {
    for (const w of WINDOWS) {
      const limit = limits[w.key];
      if (!limit || limit <= 0) continue;
      const bucket = Math.floor(now / (w.seconds * 1000));
      const key = `rl:${providerKey}:${w.name}:${bucket}`;
      const used = await redis.incr(key);
      if (used === 1) await redis.expire(key, w.seconds + 5);
      if (used > limit) {
        // Roll the counter back so a rejected call does not consume quota.
        await redis.decr(key);
        const elapsed = now - bucket * w.seconds * 1000;
        return {
          allowed: false,
          window: w.name,
          limit,
          used: used - 1,
          retryAfterSeconds: Math.max(1, Math.ceil((w.seconds * 1000 - elapsed) / 1000)),
        };
      }
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

/** Enforce a minimum delay between two requests to the same host (crawler politeness). */
export async function waitForHostSlot(host: string, delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  const key = `host-slot:${host}`;
  try {
    const last = await redis.get(key);
    const lastTs = last ? Number(last) : 0;
    const wait = lastTs + delayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, delayMs)));
    await redis.set(key, String(Date.now()), 'PX', Math.max(delayMs * 4, 10_000));
  } catch {
    // Redis unavailable: fall back to a fixed local delay so we still throttle.
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

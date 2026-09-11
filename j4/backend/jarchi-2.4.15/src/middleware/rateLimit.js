import { config } from "../config.js";
import { fail } from "./respond.js";
import { logger } from "../logger.js";
import { safeRequestPath } from "../utils/http.js";

/**
 * Fixed-window rate limiter held in process memory.
 *
 * Jarchi runs as a single PM2 fork instance (see ecosystem.config.cjs), so a
 * per-process counter is the whole picture. If the deployment is ever scaled to
 * several instances this needs a shared store — that is called out in
 * docs/SECURITY.md rather than pretended away here.
 */
const buckets = new Map();

function hit(key, windowMs, max) {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfter: 0 };
  }

  entry.count += 1;
  if (entry.count > max) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.reset - now) / 1000) };
  }
  return { allowed: true, remaining: max - entry.count, retryAfter: 0 };
}

// Keep the map from growing without bound on a long-lived process.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) if (entry.reset <= now) buckets.delete(key);
}, 60000);
sweeper.unref?.();

export function resetRateLimits() {
  buckets.clear();
}

/** Direct (non-HTTP) check, used by the Telegram bot. */
export function consume(name, identity, { windowMs, max }) {
  return hit(`${name}:${identity}`, windowMs, max);
}

export function rateLimit(name, { windowMs, max, key } = {}) {
  return (req, res, next) => {
    if (!config.rateLimit.enabled) return next();
    const identity = key ? key(req) : (req.ip || "unknown");
    const result = hit(`${name}:${identity}`, windowMs, max);

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, result.remaining)));

    if (result.allowed) return next();

    res.setHeader("Retry-After", String(result.retryAfter));
    logger.warn("rate limit exceeded", {
      request_id: req.requestId,
      limiter: name,
      path: safeRequestPath(req.originalUrl),
      ip: req.ip,
    });
    return fail(res, 429, "rate_limited", "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید");
  };
}

export const adminRateLimit = () => rateLimit("admin", {
  windowMs: config.rateLimit.adminWindowMs,
  max: config.rateLimit.adminMax,
});

export const loginRateLimit = () => rateLimit("admin-login", {
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  // Lock onto ip + username so one attacker cannot lock out every account, and
  // one account cannot be brute forced from a single address.
  key: (req) => `${req.ip}|${String(req.body?.username || "").toLowerCase().slice(0, 40)}`,
});

export const webhookRateLimit = () => rateLimit("webhook", {
  windowMs: config.rateLimit.webhookWindowMs,
  max: config.rateLimit.webhookMax,
  key: (req) => String(req.get("X-Site-ID") || req.body?.site_id || req.ip || "unknown").slice(0, 64),
});

export const apiRateLimit = () => rateLimit("api", {
  windowMs: config.rateLimit.apiWindowMs,
  max: config.rateLimit.apiMax,
});

export const customerApiRateLimit = () => rateLimit("customer-api", {
  windowMs: config.rateLimit.apiWindowMs,
  max: config.rateLimit.apiMax,
  key: (req) => String(req.user?.id || req.ip || "unknown"),
});

/*
 * AI endpoints are far more expensive than a read: each one can spend a
 * provider credit and write to the customer's store. They are keyed by user
 * rather than IP, because a Mini App user's address changes constantly.
 */
const byUser = (req) => String(req.user?.id || req.ip || "unknown");

export const aiGenerateRateLimit = () => rateLimit("ai-generate", {
  windowMs: config.ai.rateLimit.generateWindowMs,
  max: config.ai.rateLimit.generateMax,
  key: byUser,
});

export const aiImageRateLimit = () => rateLimit("ai-image", {
  windowMs: config.ai.rateLimit.imageWindowMs,
  max: config.ai.rateLimit.imageMax,
  key: byUser,
});

export const aiUploadRateLimit = () => rateLimit("ai-upload", {
  windowMs: config.ai.rateLimit.uploadWindowMs,
  max: config.ai.rateLimit.uploadMax,
  key: byUser,
});

export const aiPublishRateLimit = () => rateLimit("ai-publish", {
  windowMs: config.ai.rateLimit.publishWindowMs,
  max: config.ai.rateLimit.publishMax,
  key: byUser,
});

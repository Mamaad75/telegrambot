import { query, tx } from "../db/db.js";
import { config } from "../config.js";
import { activePaidSubscriptionForSite } from "./entitlements.js";
import { logger } from "../logger.js";
import { AiError, AI_ERROR_CODES } from "../ai/errors.js";

/**
 * AI usage accounting.
 *
 * Quotas come from the customer's existing subscription plan — there is no
 * separate AI billing system. The flow is reserve → execute → commit, so two
 * requests arriving together cannot both spend the last credit, and a job that
 * dies before it costs anything gives the credit back.
 *
 * Buckets:
 *   product  — every generation or regeneration costs one credit, because each
 *              one is a real provider call
 *   image    — one credit per generated image
 *
 * Plan columns: -1 means unlimited, 0 means the plan does not include AI.
 */

export const USAGE_OPERATIONS = Object.freeze({
  PRODUCT_GENERATION: "product_generation",
  REGENERATION: "regeneration",
  IMAGE_GENERATION: "image_generation",
  IMAGE_ANALYSIS: "image_analysis",
});

const BUCKETS = Object.freeze({
  [USAGE_OPERATIONS.PRODUCT_GENERATION]: "product",
  [USAGE_OPERATIONS.REGENERATION]: "product",
  [USAGE_OPERATIONS.IMAGE_GENERATION]: "image",
  // Image analysis rides along with a generation and is recorded, not charged.
  [USAGE_OPERATIONS.IMAGE_ANALYSIS]: null,
});

/** Billing period key in the configured display timezone, e.g. "2026-08". */
export function currentPeriod(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone, year: "numeric", month: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  return `${year}-${month}`;
}

/** The AI allowances attached to the customer's current subscription. */
export async function getQuota(userId, siteId = null) {
  const subscription = siteId
    ? await activePaidSubscriptionForSite(userId, siteId)
    : await (async () => (await query(
      `SELECT s.id,s.user_id,s.plan_id,s.starts_at,s.expires_at,s.status,p.name AS plan_name,p.is_trial,p.features,
              p.ai_products_per_month,p.ai_images_per_month
         FROM subscriptions s JOIN plans p ON p.id=s.plan_id
        WHERE s.user_id=$1 AND s.status='active' AND s.starts_at<=NOW() AND s.expires_at>NOW() AND p.active=true
        ORDER BY s.expires_at DESC LIMIT 1`, [Number(userId)],
    )).rows[0] || null)();

  if (!subscription || subscription.is_trial) return { plan_id: null, plan_name: null, active: false, product: 0, image: 0 };
  // activePaidSubscriptionForSite returns the plan without AI quota columns, so hydrate just those two columns.
  const row = (await query(`SELECT ai_products_per_month, ai_images_per_month FROM plans WHERE id=$1`, [subscription.plan_id])).rows[0] || {};
  return {
    plan_id: subscription.plan_id, plan_name: subscription.plan_name, active: true,
    expires_at: subscription.expires_at, product: Number(row.ai_products_per_month || 0), image: Number(row.ai_images_per_month || 0),
    grant_source: subscription.grant_source || null, site_id: siteId ? String(siteId) : null,
  };
}

async function usedUnits(userId, bucket, period, siteId = null) {
  const operations = Object.entries(BUCKETS)
    .filter(([, name]) => name === bucket)
    .map(([operation]) => operation);
  if (!operations.length) return 0;

  const row = (await query(
    `SELECT COALESCE(SUM(units),0)::int AS used
       FROM ai_usage
      WHERE user_id=$1 AND ($4::text IS NULL OR site_id=$4) AND period=$2 AND status IN ('reserved','committed') AND operation = ANY($3)`,
    [Number(userId), period, operations, siteId ? String(siteId) : null],
  )).rows[0];
  return Number(row.used);
}

/** Current allowance and consumption, for the usage endpoint and the panel. */
export async function getUsageSummary(userId, period = currentPeriod(), siteId = null) {
  const quota = await getQuota(userId, siteId);
  const [productUsed, imageUsed] = await Promise.all([
    usedUnits(userId, "product", period, siteId),
    usedUnits(userId, "image", period, siteId),
  ]);

  const describe = (limit, used) => ({
    limit: limit < 0 ? null : limit,
    unlimited: limit < 0,
    used,
    remaining: limit < 0 ? null : Math.max(0, limit - used),
  });

  const breakdown = (await query(
    `SELECT operation, status, COALESCE(SUM(units),0)::int AS units
       FROM ai_usage WHERE user_id=$1 AND ($3::text IS NULL OR site_id=$3) AND period=$2 GROUP BY operation, status`,
    [Number(userId), period, siteId ? String(siteId) : null],
  )).rows;

  return {
    period,
    plan: { id: quota.plan_id, name: quota.plan_name, active: quota.active },
    products: describe(quota.product, productUsed),
    images: describe(quota.image, imageUsed),
    breakdown,
  };
}

/**
 * Reserves capacity before doing the work.
 *
 * The check and the insert run in one statement: the INSERT only happens when
 * the SELECT proves there is room, so concurrent requests cannot both pass.
 */
export async function reserveUsage({ userId, siteId = null, draftId = null, jobId = null, operation, units = 1, metadata = {} }) {
  const bucket = BUCKETS[operation];
  if (bucket === undefined) {
    throw new AiError(AI_ERROR_CODES.JOB_ERROR, `Unknown usage operation: ${operation}`, { retryable: false });
  }

  const period = currentPeriod();
  const quotaSiteId = siteId ? String(siteId) : null;

  // Untracked operations are still recorded, just never blocked.
  if (bucket === null) {
    const row = (await query(
      `INSERT INTO ai_usage(user_id, site_id, draft_id, job_id, operation, units, status, period, metadata)
       VALUES($1,$2,$3,$4,$5,$6,'committed',$7,$8::jsonb) RETURNING id`,
      [Number(userId), siteId, draftId, jobId, operation, units, period, JSON.stringify(metadata)],
    )).rows[0];
    return { id: row.id, charged: false, period };
  }

  const quota = await getQuota(userId, quotaSiteId);
  const limit = bucket === "product" ? quota.product : quota.image;

  if (!quota.active) {
    throw new AiError(AI_ERROR_CODES.AI_QUOTA_ERROR, `User ${userId} has no active subscription`, {
      retryable: false,
      safeMessage: "برای استفاده از هوش مصنوعی، اشتراک فعال لازم است.",
    });
  }
  if (limit === 0) {
    throw new AiError(AI_ERROR_CODES.AI_QUOTA_ERROR, `Plan ${quota.plan_id} grants no ${bucket} credits`, {
      retryable: false,
      safeMessage: "پلن فعلی شما شامل این قابلیت هوش مصنوعی نیست.",
    });
  }

  const operations = Object.entries(BUCKETS).filter(([, name]) => name === bucket).map(([operation2]) => operation2);
  const inserted = await tx(async (client) => {
    // Serialize quota reservations per site+period+bucket. This prevents two
    // concurrent requests from both seeing the same remaining credit.
    const lockKey = `ai:${quotaSiteId || `user:${userId}`}:${period}:${bucket}`;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
    const row = (await client.query(
      `INSERT INTO ai_usage(user_id, site_id, draft_id, job_id, operation, units, status, period, metadata)
       SELECT $1,$2,$3,$4,$5,$6::int,'reserved',$7,$8::jsonb
        WHERE $9::int < 0
           OR (
             SELECT COALESCE(SUM(units),0)::int FROM ai_usage
              WHERE user_id=$1 AND ($11::text IS NULL OR site_id=$11) AND period=$7
                AND status IN ('reserved','committed') AND operation = ANY($10)
           ) + $6::int <= $9::int
       RETURNING id`,
      [Number(userId), quotaSiteId, draftId, jobId, operation, units, period, JSON.stringify(metadata), limit, operations, quotaSiteId],
    )).rows[0];
    return row?.id || null;
  });
  if (!inserted) {
    const used = await usedUnits(userId, bucket, period, quotaSiteId);
    logger.warn("ai quota exhausted", { user_id: userId, site_id: quotaSiteId, bucket, limit, used, period });
    throw new AiError(
      AI_ERROR_CODES.AI_QUOTA_ERROR,
      `Quota exhausted for ${bucket}: ${used}/${limit} in ${period}`,
      {
        retryable: false,
        safeMessage: bucket === "image"
          ? "سهمیه تولید تصویر شما در این دوره تمام شده است."
          : "سهمیه تولید محصول شما در این دوره تمام شده است.",
        meta: { bucket, limit, used, period },
      },
    );
  }

  return { id: inserted.id, charged: true, period, bucket, limit };
}

/** Confirms a reservation after the work actually happened. */
export async function commitUsage(reservationId, { provider = null, model = null, tokensIn = null, tokensOut = null, metadata = null } = {}) {
  if (!reservationId) return false;
  const result = await query(
    `UPDATE ai_usage
        SET status='committed', finalized_at=NOW(),
            provider=COALESCE($2, provider), model=COALESCE($3, model),
            tokens_in=COALESCE($4, tokens_in), tokens_out=COALESCE($5, tokens_out),
            metadata = CASE WHEN $6::jsonb IS NULL THEN metadata ELSE metadata || $6::jsonb END
      WHERE id=$1 AND status='reserved'`,
    [Number(reservationId), provider, model, tokensIn, tokensOut, metadata ? JSON.stringify(metadata) : null],
  );
  return result.rowCount > 0;
}

/** Gives the credit back when the work never happened. */
export async function releaseUsage(reservationId, reason = "not_executed") {
  if (!reservationId) return false;
  const result = await query(
    `UPDATE ai_usage
        SET status='released', finalized_at=NOW(), metadata = metadata || $2::jsonb
      WHERE id=$1 AND status='reserved'`,
    [Number(reservationId), JSON.stringify({ released_reason: reason })],
  );
  if (result.rowCount) logger.info("ai usage released", { usage_id: reservationId, reason });
  return result.rowCount > 0;
}

/** Admin view: usage per user over a period. */
export async function listUsage({ period = currentPeriod(), limit = 50 } = {}) {
  return (await query(
    `SELECT u.user_id, us.display_name, us.username,
            COALESCE(SUM(u.units) FILTER (WHERE u.operation IN ('product_generation','regeneration') AND u.status IN ('reserved','committed')),0)::int AS product_units,
            COALESCE(SUM(u.units) FILTER (WHERE u.operation='image_generation' AND u.status IN ('reserved','committed')),0)::int AS image_units,
            COUNT(*) FILTER (WHERE u.status='released')::int AS released,
            MAX(u.created_at) AS last_used_at
       FROM ai_usage u JOIN users us ON us.id = u.user_id
      WHERE u.period = $1
      GROUP BY u.user_id, us.display_name, us.username
      ORDER BY product_units DESC, image_units DESC
      LIMIT $2`,
    [period, Math.min(200, Math.max(1, Number(limit) || 50))],
  )).rows;
}

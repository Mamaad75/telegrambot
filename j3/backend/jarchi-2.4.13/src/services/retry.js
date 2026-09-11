import crypto from "node:crypto";
import { query } from "../db/db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { encryptText, decryptText } from "../utils/security.js";
import { Filters, parsePagination, paginated } from "../utils/pagination.js";
import { isRetryableError } from "../platforms/errors.js";

/**
 * Durable retry queue for failed publications.
 *
 * There was no queue in 1.2.0, so this is the only one: a small
 * PostgreSQL-backed queue rather than an in-memory list that a restart would
 * lose. Properties it must keep:
 *
 *  bounded     - max_attempts, exponential backoff with a ceiling
 *  idempotent  - one open row per (site, post, event, platform); the publish
 *                path upserts on the same key, so a repeat never forks history
 *  observable  - attempts, next_attempt_at and last_error are queryable
 *  safe        - only transport-class failures are enqueued automatically;
 *                configuration errors wait for an admin instead
 */

const WORKER_ID = `${process.pid}-${crypto.randomBytes(3).toString("hex")}`;

/**
 * The queued payload contains the whole normalized ad, which may carry an
 * advertiser phone number. It is encrypted at rest whenever a credential key is
 * configured; without one, phone-bearing values are dropped instead.
 */
function packPayload(ad) {
  if (config.credentialKey) {
    return { v: 1, enc: encryptText(JSON.stringify(ad), config.credentialKey) };
  }
  const stripped = JSON.parse(JSON.stringify(ad ?? {}));
  if (stripped.author) stripped.author.phone = "";
  if (stripped.fields) {
    for (const key of Object.keys(stripped.fields)) {
      if (/phone|mobile|tel/i.test(key)) delete stripped.fields[key];
    }
  }
  return { v: 1, plain: stripped, phone_stripped: true };
}

export function unpackPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.enc) {
    if (!config.credentialKey) throw new Error("PLATFORM_CREDENTIAL_KEY is required to read this retry payload");
    return JSON.parse(decryptText(payload.enc, config.credentialKey));
  }
  return payload.plain || null;
}

/** Exponential backoff with jitter, capped by config.retry.maxDelayMs. */
export function backoffMs(attempts, { baseDelayMs = config.retry.baseDelayMs, maxDelayMs = config.retry.maxDelayMs } = {}) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempts - 1));
  const jitter = Math.floor(Math.random() * Math.min(30000, exponential * 0.2));
  return exponential + jitter;
}

/**
 * Adds (or refreshes) a retry for one publication target.
 * `requestedBy` distinguishes an automatic enqueue from an admin-triggered one.
 */
export async function enqueueRetry({ ad, platform, publicationId = null, requestedBy = "system", delayMs = null, maxAttempts = config.retry.maxAttempts }) {
  if (!config.retry.enabled) return null;

  const delay = Number.isFinite(delayMs) ? delayMs : backoffMs(1);
  const row = (await query(
    `INSERT INTO publication_retries(
       publication_id,site_id,post_id,event_type,platform,payload,status,attempts,
       max_attempts,next_attempt_at,requested_by)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,'pending',0,$7,NOW()+($8||' milliseconds')::interval,$9)
     ON CONFLICT (site_id,post_id,event_type,platform) WHERE status IN ('pending','processing')
     DO UPDATE SET
       payload=EXCLUDED.payload,
       max_attempts=GREATEST(publication_retries.max_attempts,EXCLUDED.max_attempts),
       next_attempt_at=LEAST(publication_retries.next_attempt_at,EXCLUDED.next_attempt_at),
       status='pending',
       locked_at=NULL,
       locked_by=NULL,
       updated_at=NOW()
     RETURNING id,attempts,max_attempts,next_attempt_at,status`,
    [
      publicationId,
      String(ad.site_id),
      String(ad.post_id),
      String(ad.event_type),
      String(platform),
      JSON.stringify(packPayload(ad)),
      Math.max(1, Math.min(20, Number(maxAttempts) || config.retry.maxAttempts)),
      String(Math.max(0, Math.trunc(delay))),
      String(requestedBy).slice(0, 64),
    ],
  )).rows[0];

  logger.info("publication retry queued", {
    retry_id: row.id,
    site_id: ad.site_id,
    post_id: ad.post_id,
    platform,
    requested_by: requestedBy,
    next_attempt_at: row.next_attempt_at,
  });
  return row;
}

/** Automatic enqueue, applied only to failures a repeat could actually fix. */
export async function maybeEnqueueAutomatic({ ad, platform, publicationId, error }) {
  if (!config.retry.enabled || !config.retry.autoEnqueue) return null;
  if (!isRetryableError(error)) return null;
  const delay = Number(error?.retryAfterMs) > 0 ? Number(error.retryAfterMs) : backoffMs(1);
  return enqueueRetry({ ad, platform, publicationId, requestedBy: "system", delayMs: delay });
}

/**
 * Claims due retries for this worker. `FOR UPDATE SKIP LOCKED` keeps two
 * workers (or a worker and a manual run) from picking up the same row.
 */
export async function claimDueRetries(limit = config.retry.batchSize) {
  return (await query(
    `UPDATE publication_retries r
        SET status='processing', locked_at=NOW(), locked_by=$2, updated_at=NOW()
      WHERE r.id IN (
        SELECT id FROM publication_retries
         WHERE status='pending' AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [Math.max(1, Math.min(50, Number(limit) || 10)), WORKER_ID],
  )).rows;
}

/** Returns rows stuck in `processing` (crashed worker) to the pending pool. */
export async function reclaimStuckRetries(timeoutMs = config.retry.lockTimeoutMs) {
  const result = await query(
    `UPDATE publication_retries
        SET status='pending', locked_at=NULL, locked_by=NULL, updated_at=NOW()
      WHERE status='processing' AND locked_at < NOW() - ($1||' milliseconds')::interval`,
    [String(Math.max(1000, Number(timeoutMs) || 300000))],
  );
  if (result.rowCount) logger.warn("reclaimed stuck publication retries", { count: result.rowCount });
  return result.rowCount;
}

export async function completeRetry(id, { ok, error = null }) {
  if (ok) {
    await query(
      "UPDATE publication_retries SET status='succeeded',attempts=attempts+1,locked_at=NULL,locked_by=NULL,last_error=NULL,updated_at=NOW() WHERE id=$1",
      [Number(id)],
    );
    return { status: "succeeded" };
  }

  const row = (await query("SELECT attempts,max_attempts FROM publication_retries WHERE id=$1", [Number(id)])).rows[0];
  const attempts = Number(row?.attempts || 0) + 1;
  const exhausted = attempts >= Number(row?.max_attempts || config.retry.maxAttempts);

  await query(
    `UPDATE publication_retries
        SET attempts=$2,
            status=$3,
            next_attempt_at=NOW()+($4||' milliseconds')::interval,
            last_error=$5,
            locked_at=NULL, locked_by=NULL, updated_at=NOW()
      WHERE id=$1`,
    [
      Number(id), attempts,
      exhausted ? "failed" : "pending",
      String(exhausted ? 0 : backoffMs(attempts)),
      error ? String(error).slice(0, 500) : null,
    ],
  );
  return { status: exhausted ? "failed" : "pending", attempts };
}

export async function cancelRetry(id) {
  const result = await query(
    "UPDATE publication_retries SET status='cancelled',locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=$1 AND status IN ('pending','processing') RETURNING id",
    [Number(id)],
  );
  return result.rowCount > 0;
}

export async function listRetries(input = {}) {
  const { page, pageSize, limit, offset } = parsePagination(input);
  const filters = new Filters();
  filters
    .add("r.site_id = ?", input.site_id)
    .add("r.platform = ?", input.platform)
    .add("r.status = ?", input.status)
    .add("r.post_id = ?", input.post_id);
  const where = filters.where();

  const rows = (await query(
    `SELECT r.id,r.publication_id,r.site_id,r.post_id,r.event_type,r.platform,r.status,
            r.attempts,r.max_attempts,r.next_attempt_at,r.last_error,r.requested_by,
            r.created_at,r.updated_at, s.name AS site_name
       FROM publication_retries r LEFT JOIN sites s ON s.id=r.site_id
       ${where} ORDER BY r.id DESC LIMIT ${limit} OFFSET ${offset}`,
    filters.params,
  )).rows;
  const total = (await query(`SELECT COUNT(*)::int AS count FROM publication_retries r ${where}`, filters.params)).rows[0].count;
  return paginated(rows, total, { page, pageSize });
}

export async function retrySummary() {
  return (await query(
    `SELECT status, COUNT(*)::int AS count FROM publication_retries GROUP BY status`,
  )).rows.reduce((accumulator, row) => ({ ...accumulator, [row.status]: row.count }), {});
}

/**
 * Processes one batch of due retries.
 *
 * core/publication.js is imported lazily: the publication engine enqueues into
 * this module, and importing it eagerly here would close that cycle.
 */
export async function runRetryWorker({ limit = config.retry.batchSize } = {}) {
  if (!config.retry.enabled) return { processed: 0, succeeded: 0, failed: 0 };

  await reclaimStuckRetries();
  const jobs = await claimDueRetries(limit);
  if (!jobs.length) return { processed: 0, succeeded: 0, failed: 0 };

  const { republishTarget } = await import("../core/publication.js");
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const started = Date.now();
    try {
      const ad = unpackPayload(job.payload);
      if (!ad) throw new Error("Retry payload is unreadable");
      const result = await republishTarget(ad, job.platform, { attempt: Number(job.attempts) + 1 });
      if (result.status !== "published") throw new Error(result.error || `Retry ended as ${result.status}`);

      await completeRetry(job.id, { ok: true });
      succeeded += 1;
      logger.info("publication retry succeeded", {
        retry_id: job.id, site_id: job.site_id, post_id: job.post_id,
        platform: job.platform, attempt: Number(job.attempts) + 1, duration_ms: Date.now() - started,
      });
    } catch (error) {
      const outcome = await completeRetry(job.id, { ok: false, error: error.message });
      failed += 1;
      logger.warn("publication retry attempt failed", {
        retry_id: job.id, site_id: job.site_id, post_id: job.post_id, platform: job.platform,
        attempt: outcome.attempts, status: outcome.status, error: error.message,
        duration_ms: Date.now() - started,
      });
    }
  }

  return { processed: jobs.length, succeeded, failed };
}

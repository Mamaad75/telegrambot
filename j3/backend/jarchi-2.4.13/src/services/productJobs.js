import crypto from "node:crypto";
import { query } from "../db/db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { backoffMs } from "./retry.js";
import { AiError, AI_ERROR_CODES } from "../ai/errors.js";

/**
 * Job queue for AI work.
 *
 * The claiming pattern is the one the publication retry queue already proved:
 * FOR UPDATE SKIP LOCKED, bounded attempts, exponential backoff, stale-lock
 * reclaim. The table is separate because the shape is different — AI jobs are
 * multi-step workflows keyed by draft, not one ad going to one platform — and
 * overloading publication_retries would have made both harder to reason about.
 *
 * `backoffMs` is imported rather than reimplemented so both queues age the same
 * way.
 */

export const JOB_TYPES = Object.freeze({
  GENERATE: "generate",
  REGENERATE: "regenerate",
  PUBLISH: "publish",
  GENERATE_IMAGE: "generate_image",
});

export const JOB_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const WORKER_ID = `${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
const publicId = () => `job_${crypto.randomBytes(9).toString("base64url")}`;

/**
 * Enqueues a job.
 *
 * The partial unique index on (draft_id, type) for open jobs is what makes this
 * idempotent: a second click while the first job is still pending returns that
 * job instead of starting another generation — or another product.
 */
export async function enqueueJob({
  draftId = null, userId, siteId = null, type, payload = {},
  idempotencyKey = null, maxAttempts = config.ai.worker.maxAttempts, delayMs = 0,
}) {
  if (!Object.values(JOB_TYPES).includes(type)) {
    throw new AiError(AI_ERROR_CODES.JOB_ERROR, `Unknown job type: ${type}`, { retryable: false });
  }

  const inserted = (await query(
    `INSERT INTO ai_jobs(public_id, draft_id, user_id, site_id, type, payload, status,
                         max_attempts, next_attempt_at, idempotency_key)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,'pending',$7, NOW() + ($8||' milliseconds')::interval, $9)
     ON CONFLICT (draft_id, type) WHERE status IN ('pending','processing') DO NOTHING
     RETURNING *`,
    [
      publicId(), draftId, Number(userId), siteId, type, JSON.stringify(payload),
      Math.max(1, Math.min(10, Number(maxAttempts) || 3)),
      String(Math.max(0, Math.trunc(delayMs))),
      idempotencyKey ? String(idempotencyKey).slice(0, 100) : null,
    ],
  )).rows[0];

  if (inserted) {
    logger.info("ai job queued", {
      job_id: inserted.public_id, type, draft_id: draftId, user_id: userId, site_id: siteId,
    });
    return { job: inserted, created: true };
  }

  // An open job of this type already exists for the draft: hand it back so the
  // caller reports "already running" rather than creating a duplicate.
  const existing = (await query(
    `SELECT * FROM ai_jobs
      WHERE draft_id=$1 AND type=$2 AND status IN ('pending','processing')
      ORDER BY id DESC LIMIT 1`,
    [draftId, type],
  )).rows[0];
  return { job: existing, created: false };
}

export async function getJob(id, { userId = null } = {}) {
  const numeric = Number.isFinite(Number(id)) ? Number(id) : 0;
  const row = (await query("SELECT * FROM ai_jobs WHERE public_id=$1 OR id=$2", [String(id), numeric])).rows[0];
  if (!row) return null;
  if (userId !== null && String(row.user_id) !== String(userId)) {
    throw new AiError(AI_ERROR_CODES.PERMISSION_ERROR, `User ${userId} may not read job ${row.public_id}`);
  }
  return row;
}

export async function latestJobForDraft(draftId) {
  return (await query(
    "SELECT * FROM ai_jobs WHERE draft_id=$1 ORDER BY id DESC LIMIT 1",
    [Number(draftId)],
  )).rows[0] || null;
}

/** Claims due jobs for this worker; another worker cannot take the same row. */
export async function claimJobs(limit = config.ai.worker.batchSize) {
  return (await query(
    `UPDATE ai_jobs j
        SET status='processing', locked_at=NOW(), locked_by=$2,
            attempts=attempts+1, started_at=COALESCE(started_at, NOW()), updated_at=NOW()
      WHERE j.id IN (
        SELECT id FROM ai_jobs
         WHERE status='pending' AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [Math.max(1, Math.min(20, Number(limit) || 3)), WORKER_ID],
  )).rows;
}

/** Returns jobs abandoned by a crashed worker to the pending pool. */
export async function reclaimStaleJobs(timeoutMs = config.ai.worker.lockTimeoutMs) {
  const result = await query(
    `UPDATE ai_jobs
        SET status='pending', locked_at=NULL, locked_by=NULL, updated_at=NOW()
      WHERE status='processing' AND locked_at < NOW() - ($1||' milliseconds')::interval`,
    [String(Math.max(1000, Number(timeoutMs) || 300000))],
  );
  if (result.rowCount) logger.warn("reclaimed stale ai jobs", { count: result.rowCount });
  return result.rowCount;
}

export async function updateProgress(jobId, progress = {}) {
  await query(
    "UPDATE ai_jobs SET progress = progress || $2::jsonb, updated_at=NOW() WHERE id=$1",
    [Number(jobId), JSON.stringify(progress)],
  );
}

export async function completeJob(jobId, { result = {}, durationMs = null } = {}) {
  const row = (await query(
    `UPDATE ai_jobs
        SET status='succeeded', result=$2::jsonb, finished_at=NOW(), duration_ms=$3,
            locked_at=NULL, locked_by=NULL, last_error=NULL, error_code=NULL, updated_at=NOW()
      WHERE id=$1 RETURNING *`,
    [Number(jobId), JSON.stringify(result), durationMs],
  )).rows[0];
  return row;
}

/**
 * Records a failed attempt.
 * Retryable failures go back to pending with backoff until attempts run out;
 * anything else fails immediately, because repeating it would not help.
 */
export async function failJob(jobId, error, { durationMs = null } = {}) {
  const job = (await query("SELECT attempts, max_attempts FROM ai_jobs WHERE id=$1", [Number(jobId)])).rows[0];
  if (!job) return null;

  const aiError = error instanceof AiError ? error : new AiError(AI_ERROR_CODES.JOB_ERROR, String(error?.message || error));
  const attempts = Number(job.attempts);
  const exhausted = attempts >= Number(job.max_attempts);
  const willRetry = aiError.retryable && !exhausted;

  const row = (await query(
    `UPDATE ai_jobs
        SET status=$2,
            error_code=$3,
            last_error=$4,
            next_attempt_at=NOW() + ($5||' milliseconds')::interval,
            duration_ms=COALESCE($6, duration_ms),
            finished_at=CASE WHEN $2='failed' THEN NOW() ELSE finished_at END,
            locked_at=NULL, locked_by=NULL, updated_at=NOW()
      WHERE id=$1 RETURNING *`,
    [
      Number(jobId),
      willRetry ? "pending" : "failed",
      aiError.code,
      aiError.detail.slice(0, 1000),
      String(willRetry ? backoffMs(attempts, {
        baseDelayMs: config.ai.worker.baseDelayMs,
        maxDelayMs: config.ai.worker.maxDelayMs,
      }) : 0),
      durationMs,
    ],
  )).rows[0];

  logger.warn("ai job attempt failed", {
    job_id: row.public_id, type: row.type, draft_id: row.draft_id, attempt: attempts,
    will_retry: willRetry, error_code: aiError.code, error: aiError.detail,
  });
  return row;
}

export async function cancelJob(jobId) {
  const result = await query(
    `UPDATE ai_jobs SET status='cancelled', locked_at=NULL, locked_by=NULL, finished_at=NOW(), updated_at=NOW()
      WHERE id=$1 AND status IN ('pending','processing') RETURNING id`,
    [Number(jobId)],
  );
  return result.rowCount > 0;
}

/** Customer-facing job view: status and progress, never internal detail. */
export function toJobView(job) {
  if (!job) return null;
  return {
    id: job.public_id,
    type: job.type,
    status: job.status,
    progress: job.progress || {},
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    error: job.error_code ? { code: job.error_code } : null,
    duration_ms: job.duration_ms,
    created_at: job.created_at,
    finished_at: job.finished_at,
  };
}

/** Admin view with filters. */
export async function listJobs({ status = null, type = null, userId = null, siteId = null, page = 1, pageSize = 25 } = {}) {
  const limit = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;

  const rows = (await query(
    `SELECT j.*, d.public_id AS draft_public_id, u.display_name, u.username
       FROM ai_jobs j
       LEFT JOIN ai_product_drafts d ON d.id = j.draft_id
       LEFT JOIN users u ON u.id = j.user_id
      WHERE ($1::text IS NULL OR j.status=$1)
        AND ($2::text IS NULL OR j.type=$2)
        AND ($3::bigint IS NULL OR j.user_id=$3)
        AND ($4::text IS NULL OR j.site_id=$4)
      ORDER BY j.id DESC LIMIT $5 OFFSET $6`,
    [status, type, userId ? Number(userId) : null, siteId, limit, offset],
  )).rows;

  const total = (await query(
    `SELECT COUNT(*)::int AS count FROM ai_jobs j
      WHERE ($1::text IS NULL OR j.status=$1) AND ($2::text IS NULL OR j.type=$2)
        AND ($3::bigint IS NULL OR j.user_id=$3) AND ($4::text IS NULL OR j.site_id=$4)`,
    [status, type, userId ? Number(userId) : null, siteId],
  )).rows[0].count;

  return {
    items: rows,
    pagination: { page: Math.max(1, Number(page) || 1), page_size: limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function jobSummary() {
  return (await query(
    `SELECT status, type, COUNT(*)::int AS count,
            AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)::int AS avg_duration_ms
       FROM ai_jobs GROUP BY status, type ORDER BY status, type`,
  )).rows;
}

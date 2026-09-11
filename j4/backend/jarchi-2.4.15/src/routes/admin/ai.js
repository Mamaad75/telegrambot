import express from "express";
import { ok, handler, notFound, badRequest } from "../../middleware/respond.js";
import { requirePermission } from "../../middleware/adminAuth.js";
import { PERMISSIONS } from "../../core/rbac.js";
import { recordAudit } from "../../services/audit.js";
import { query } from "../../db/db.js";
import * as jobs from "../../services/productJobs.js";
import * as usage from "../../services/aiUsage.js";
import { runProductWorker } from "../../workers/productWorker.js";
import { purgeAbandonedUploads } from "../../services/productImages.js";
import { config } from "../../config.js";
import { requireInt, requireEnum, optionalString } from "../../middleware/validate.js";

/**
 * Administrator visibility into AI product automation.
 *
 * Read paths need ai.view (every role has it); anything that acts — retrying a
 * job, cancelling one, sweeping media — needs ai.manage, and is audited like
 * every other admin action.
 */
export const aiAdminRoutes = express.Router();

aiAdminRoutes.get("/overview", requirePermission(PERMISSIONS.AI_VIEW), handler(async (req, res) => {
  const [summary, drafts, failures, connections] = await Promise.all([
    jobs.jobSummary(),
    query(`SELECT status, COUNT(*)::int AS count FROM ai_product_drafts GROUP BY status ORDER BY count DESC`),
    query(
      `SELECT j.public_id, j.type, j.error_code, j.last_error, j.attempts, j.max_attempts,
              j.site_id, j.created_at, d.public_id AS draft_public_id
         FROM ai_jobs j LEFT JOIN ai_product_drafts d ON d.id = j.draft_id
        WHERE j.status='failed' ORDER BY j.id DESC LIMIT 10`,
    ),
    query(
      `SELECT site_id, base_url, last_tested_at, last_test_ok, last_test_error
         FROM woocommerce_connections WHERE last_test_ok IS DISTINCT FROM true
         ORDER BY updated_at DESC LIMIT 10`,
    ),
  ]);

  return ok(res, {
    ai: {
      enabled: config.ai.enabled,
      provider: config.ai.provider,
      image_generation: config.ai.enableImageGeneration,
      worker_enabled: config.ai.worker.enabled,
    },
    jobs: summary,
    drafts: drafts.rows,
    recent_failures: failures.rows,
    // Connections whose last test did not pass — the usual cause of publish failures.
    failing_connections: connections.rows,
  });
}));

aiAdminRoutes.get("/jobs", requirePermission(PERMISSIONS.AI_VIEW), handler(async (req, res) => {
  return ok(res, await jobs.listJobs({
    status: req.query.status || null,
    type: req.query.type || null,
    userId: req.query.user_id || null,
    siteId: req.query.site_id || null,
    page: req.query.page,
    pageSize: req.query.page_size,
  }));
}));

aiAdminRoutes.get("/jobs/:id", requirePermission(PERMISSIONS.AI_VIEW), handler(async (req, res) => {
  const job = await jobs.getJob(req.params.id);
  if (!job) throw notFound("کار یافت نشد");
  return ok(res, { job });
}));

aiAdminRoutes.post("/jobs/:id/retry", requirePermission(PERMISSIONS.AI_MANAGE), handler(async (req, res) => {
  const job = await jobs.getJob(req.params.id);
  if (!job) throw notFound("کار یافت نشد");
  if (job.status !== "failed") throw badRequest("فقط کارهای ناموفق قابل اجرای مجدد هستند");

  const row = (await query(
    `UPDATE ai_jobs SET status='pending', attempts=0, next_attempt_at=NOW(),
            error_code=NULL, last_error=NULL, updated_at=NOW()
      WHERE id=$1 RETURNING *`,
    [job.id],
  )).rows[0];

  await recordAudit({
    actor: req.admin, action: "ai.job.retry", targetType: "ai_job", targetId: job.public_id,
    requestId: req.requestId, ip: req.ip, channel: "web",
    metadata: { type: job.type, site_id: job.site_id, previous_error: job.error_code },
  });
  return ok(res, { job: row });
}));

aiAdminRoutes.post("/jobs/:id/cancel", requirePermission(PERMISSIONS.AI_MANAGE), handler(async (req, res) => {
  const job = await jobs.getJob(req.params.id);
  if (!job) throw notFound("کار یافت نشد");
  const cancelled = await jobs.cancelJob(job.id);

  await recordAudit({
    actor: req.admin, action: "ai.job.cancel", targetType: "ai_job", targetId: job.public_id,
    success: cancelled, requestId: req.requestId, ip: req.ip, channel: "web",
  });
  return ok(res, { cancelled });
}));

aiAdminRoutes.post("/jobs/run", requirePermission(PERMISSIONS.AI_MANAGE), handler(async (req, res) => {
  const result = await runProductWorker({ limit: config.ai.worker.batchSize });
  await recordAudit({
    actor: req.admin, action: "ai.worker.run", targetType: "ai_jobs", targetId: "batch",
    requestId: req.requestId, ip: req.ip, channel: "web", metadata: result,
  });
  return ok(res, { result });
}));

aiAdminRoutes.get("/drafts", requirePermission(PERMISSIONS.AI_VIEW), handler(async (req, res) => {
  const status = optionalString(req.query.status, "status", { max: 40 });
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 25));

  const rows = (await query(
    `SELECT d.public_id, d.user_id, d.site_id, d.status, d.language, d.confidence,
            d.wc_product_id, d.wc_permalink, d.provider, d.model, d.error_code,
            d.created_at, d.updated_at, u.display_name, u.username,
            jsonb_array_length(COALESCE(d.warnings,'[]'::jsonb)) AS warning_count
       FROM ai_product_drafts d LEFT JOIN users u ON u.id = d.user_id
      WHERE ($1::text IS NULL OR d.status = $1)
        AND ($2::text IS NULL OR d.site_id = $2)
      ORDER BY d.id DESC LIMIT $3 OFFSET $4`,
    [status || null, req.query.site_id || null, pageSize, (page - 1) * pageSize],
  )).rows;

  const total = (await query(
    `SELECT COUNT(*)::int AS count FROM ai_product_drafts d
      WHERE ($1::text IS NULL OR d.status=$1) AND ($2::text IS NULL OR d.site_id=$2)`,
    [status || null, req.query.site_id || null],
  )).rows[0].count;

  // Generated content itself is the customer's; admins see status, not copy.
  return ok(res, {
    items: rows,
    pagination: { page, page_size: pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}));

aiAdminRoutes.get("/usage", requirePermission(PERMISSIONS.AI_VIEW), handler(async (req, res) => {
  const period = optionalString(req.query.period, "period", { max: 7 }) || usage.currentPeriod();
  return ok(res, { period, usage: await usage.listUsage({ period, limit: req.query.limit }) });
}));

aiAdminRoutes.get("/connections", requirePermission(PERMISSIONS.AI_VIEW), handler(async (req, res) => {
  const rows = (await query(
    `SELECT c.site_id, s.name AS site_name, c.base_url, c.status, c.last_tested_at,
            c.last_test_ok, c.last_test_error, c.store_info, c.created_at
       FROM woocommerce_connections c LEFT JOIN sites s ON s.id = c.site_id
      ORDER BY c.updated_at DESC LIMIT 200`,
  )).rows;
  // Credentials are not selected at all, so they cannot leak from here.
  return ok(res, { connections: rows });
}));

aiAdminRoutes.post("/media/purge", requirePermission(PERMISSIONS.AI_MANAGE), handler(async (req, res) => {
  const hours = req.body?.older_than_hours === undefined
    ? config.ai.mediaTtlHours
    : requireInt(req.body.older_than_hours, "older_than_hours", { min: 1, max: 8760 });

  const removed = await purgeAbandonedUploads({ olderThanHours: hours });
  await recordAudit({
    actor: req.admin, action: "ai.media.purge", targetType: "ai_media", targetId: "abandoned",
    requestId: req.requestId, ip: req.ip, channel: "web", metadata: { removed, older_than_hours: hours },
  });
  return ok(res, { removed });
}));

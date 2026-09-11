import express from "express";
import { ok, handler, notFound, badRequest, conflict } from "../../middleware/respond.js";
import { requirePermission } from "../../middleware/adminAuth.js";
import { PERMISSIONS, can } from "../../core/rbac.js";
import { recordAudit } from "../../services/audit.js";
import {
  listPublications, getPublication, isRetryEligible, platformDistribution, recentFailures,
} from "../../services/publications.js";
import { listRetries, enqueueRetry, cancelRetry, runRetryWorker, retrySummary } from "../../services/retry.js";
import { query } from "../../db/db.js";
import { config } from "../../config.js";
import { decryptText } from "../../utils/security.js";
import {
  optionalPlatform, optionalEnum, requireInt, optionalString,
  EVENT_TYPE_VALUES, PUBLICATION_STATUS_VALUES,
} from "../../middleware/validate.js";

export const publicationRoutes = express.Router();

publicationRoutes.get("/", requirePermission(PERMISSIONS.PUBLICATIONS_VIEW), handler(async (req, res) => {
  const filters = {
    ...req.query,
    platform: optionalPlatform(req.query.platform),
    event_type: optionalEnum(req.query.event_type, EVENT_TYPE_VALUES, "event_type"),
    status: optionalEnum(req.query.status, PUBLICATION_STATUS_VALUES, "status"),
    post_id: optionalString(req.query.post_id, "post_id", { max: 64 }),
  };
  return ok(res, await listPublications(filters, {
    allowPhone: can(req.admin, PERMISSIONS.USERS_PHONE_VIEW),
  }));
}));

publicationRoutes.get("/stats", requirePermission(PERMISSIONS.PUBLICATIONS_VIEW), handler(async (req, res) => ok(res, {
  platform_distribution: await platformDistribution(),
  recent_failures: await recentFailures(10),
  retries: await retrySummary(),
})));

/* Retry queue -------------------------------------------------------- */

publicationRoutes.get("/retries", requirePermission(PERMISSIONS.PUBLICATIONS_VIEW), handler(async (req, res) => {
  return ok(res, await listRetries(req.query));
}));

publicationRoutes.post("/retries/run", requirePermission(PERMISSIONS.PUBLICATIONS_RETRY), handler(async (req, res) => {
  const result = await runRetryWorker({ limit: config.retry.batchSize });
  await recordAudit({
    actor: req.admin, action: "publication.retry.run", targetType: "retry_queue", targetId: "batch",
    requestId: req.requestId, ip: req.ip, channel: "web", metadata: result,
  });
  return ok(res, { result });
}));

publicationRoutes.post("/retries/:id/cancel", requirePermission(PERMISSIONS.PUBLICATIONS_RETRY), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const cancelled = await cancelRetry(id);
  if (!cancelled) throw conflict("این مورد قابل لغو نیست");

  await recordAudit({
    actor: req.admin, action: "publication.retry.cancel", targetType: "retry", targetId: id,
    requestId: req.requestId, ip: req.ip, channel: "web",
  });
  return ok(res, { cancelled: true });
}));

publicationRoutes.get("/:id", requirePermission(PERMISSIONS.PUBLICATIONS_VIEW), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const publication = await getPublication(id, { allowPhone: can(req.admin, PERMISSIONS.USERS_PHONE_VIEW) });
  if (!publication) throw notFound("انتشار یافت نشد");
  return ok(res, { publication });
}));

/**
 * Queues a failed publication for another attempt.
 *
 * The ad payload is rebuilt from the stored publication and the site's current
 * field catalog is irrelevant here — the retry worker re-resolves targets and
 * policy at execution time, so a target fixed in the meantime takes effect.
 */
publicationRoutes.post("/:id/retry", requirePermission(PERMISSIONS.PUBLICATIONS_RETRY), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const row = (await query("SELECT * FROM publications WHERE id=$1", [id])).rows[0];
  if (!row) throw notFound("انتشار یافت نشد");
  if (!isRetryEligible(row)) {
    throw badRequest("فقط انتشارهای ناموفق از نوع created/published/updated قابل تلاش مجدد هستند");
  }

  const existing = (await query(
    `SELECT payload FROM publication_retries
      WHERE site_id=$1 AND post_id=$2 AND event_type=$3 AND platform=$4
      ORDER BY id DESC LIMIT 1`,
    [row.site_id, row.post_id, row.event_type, row.platform],
  )).rows[0];

  /*
   * A retry needs the original ad. It is available when the failure was queued
   * automatically (payload kept, encrypted). Without it the backend cannot
   * invent the ad body, so the admin is told to re-trigger from WordPress
   * rather than being shown a retry that would publish an empty message.
   */
  if (!existing?.payload) {
    throw badRequest(
      "محتوای اصلی این انتشار ذخیره نشده است؛ برای ارسال مجدد، رویداد را از وردپرس دوباره ارسال کنید",
    );
  }

  const payload = existing.payload.enc
    ? JSON.parse(decryptText(existing.payload.enc, config.credentialKey))
    : existing.payload.plain;

  const queued = await enqueueRetry({
    ad: payload,
    platform: row.platform,
    publicationId: row.id,
    requestedBy: `admin:${req.admin.username}`,
    delayMs: 0,
  });

  await recordAudit({
    actor: req.admin, action: "publication.retry", targetType: "publication", targetId: id,
    requestId: req.requestId, ip: req.ip, channel: "web",
    metadata: { platform: row.platform, site_id: row.site_id, post_id: row.post_id },
  });
  return ok(res, { retry: queued });
}));

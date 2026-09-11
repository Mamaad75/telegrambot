import express from "express";
import { config } from "../config.js";
import { siteServiceAuth } from "../middleware/siteServiceAuth.js";
import { apiRateLimit, aiGenerateRateLimit, aiImageRateLimit, aiUploadRateLimit, aiPublishRateLimit } from "../middleware/rateLimit.js";
import { aiAvailable } from "../ai/index.js";
import { AiError, AI_ERROR_CODES } from "../ai/errors.js";
import { ALLOWED_IMAGE_TYPES, decodeBase64Image } from "../ai/image/validation.js";
import * as drafts from "../services/productDrafts.js";
import * as jobs from "../services/productJobs.js";
import * as images from "../services/productImages.js";
import * as usage from "../services/aiUsage.js";
import * as woocommerce from "../services/woocommerce.js";
import { getSettings } from "../services/siteProductSettings.js";
import { logger } from "../logger.js";

export const siteAi = express.Router();
// The router is mounted at /api, so a bare use() would also run for every
// other /api path (admin included) and siteServiceAuth would reject them for a
// missing siteId. Scoping the guard to the paths this router owns keeps the
// site secret check where it belongs and leaves neighbouring routers alone.
siteAi.use("/sites/:siteId/ai", apiRateLimit(), siteServiceAuth);

const route = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (error instanceof AiError) {
      return res.status(error.status).json(error.toResponse());
    }
    logger.error("site AI request failed", { request_id: req.requestId, site_id: req.site?.id, error });
    return res.status(500).json({ success: false, error: "Internal error", error_code: AI_ERROR_CODES.JOB_ERROR });
  }
};

function requireAiEnabled() {
  if (!aiAvailable()) throw new AiError(AI_ERROR_CODES.AI_DISABLED, "AI is not configured", { retryable: false });
}

async function ownedDraft(req) {
  const draft = await drafts.getDraft(req.params.id, { userId: req.user.id });
  if (!draft || String(draft.site_id) !== String(req.site.id)) {
    throw new AiError(AI_ERROR_CODES.NOT_FOUND, "Draft not found");
  }
  return draft;
}

async function enqueueGeneration(req, { type, payload = {}, operation }) {
  requireAiEnabled();
  const draft = await ownedDraft(req);
  const reservation = await usage.reserveUsage({
    userId: req.user.id,
    siteId: req.site.id,
    draftId: draft.id,
    operation,
    metadata: { trigger: "wordpress_plugin", request_id: req.requestId, ...payload },
  });
  const queued = await jobs.enqueueJob({
    draftId: draft.id,
    userId: req.user.id,
    siteId: req.site.id,
    type,
    payload: { ...payload, usage_id: reservation.id, source: "wordpress_plugin" },
    idempotencyKey: req.get("Idempotency-Key") || null,
  });
  if (!queued.created) await usage.releaseUsage(reservation.id, "duplicate_job");
  return queued;
}

siteAi.get("/sites/:siteId/ai/status", route(async (req, res) => {
  res.json({
    success: true,
    ai: {
      available: aiAvailable(),
      image_generation: config.ai.enableImageGeneration,
      default_language: config.ai.defaultLanguage,
      max_images_per_product: config.ai.maxImagesPerDraft,
      accepted_image_types: ALLOWED_IMAGE_TYPES,
    },
    settings: await getSettings(req.site.id),
    usage: await usage.getUsageSummary(req.user.id, undefined, req.site?.id || null),
  });
}));

/** First-party WordPress integration entrypoint. */
siteAi.post("/sites/:siteId/ai/products", aiGenerateRateLimit(), route(async (req, res) => {
  requireAiEnabled();
  const settings = await getSettings(req.site.id);
  const source = req.body?.source && typeof req.body.source === "object" ? req.body.source : {};
  const sourceType = String(source.type || "wordpress").slice(0, 40);
  const sourceId = source.id === undefined || source.id === null ? null : String(source.id).slice(0, 120);
  const sourceKey = source.key
    ? String(source.key).slice(0, 200)
    : (sourceId ? `${sourceType}:${sourceId}` : null);

  const { draft, created } = await drafts.createDraft({
    userId: req.user.id,
    siteId: req.site.id,
    input: req.body?.input || req.body || {},
    language: req.body?.language || settings.language,
    idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotency_key || null,
    sourceType,
    sourceId,
    sourceKey,
    sourceMetadata: source.metadata || {},
  });

  if (!created) {
    return res.json({ success: true, created: false, product: drafts.toCustomerView(draft, { job: await jobs.latestJobForDraft(draft.id) }) });
  }

  let job = null;
  if (req.body?.generate !== false && settings.auto_generate_content) {
    const reservation = await usage.reserveUsage({
      userId: req.user.id, siteId: req.site.id, draftId: draft.id,
      operation: usage.USAGE_OPERATIONS.PRODUCT_GENERATION,
      metadata: { trigger: "wordpress_plugin", source_type: sourceType, source_id: sourceId },
    });
    const queued = await jobs.enqueueJob({
      draftId: draft.id, userId: req.user.id, siteId: req.site.id,
      type: jobs.JOB_TYPES.GENERATE,
      payload: { usage_id: reservation.id, source: "wordpress_plugin" },
      idempotencyKey: req.get("Idempotency-Key") || null,
    });
    if (!queued.created) await usage.releaseUsage(reservation.id, "duplicate_job");
    job = queued.job;
  }

  return res.status(201).json({
    success: true,
    created: true,
    product: drafts.toCustomerView(draft, { job }),
    job: jobs.toJobView(job),
  });
}));

siteAi.get("/sites/:siteId/ai/products", route(async (req, res) => {
  const result = await drafts.listDrafts({
    userId: req.user.id,
    siteId: req.site.id,
    status: req.query.status || null,
    page: req.query.page,
    pageSize: req.query.page_size,
  });
  res.json({ success: true, products: result.items.map((draft) => drafts.toCustomerView(draft)), pagination: result.pagination });
}));

siteAi.get("/sites/:siteId/ai/products/:id", route(async (req, res) => {
  const draft = await ownedDraft(req);
  res.json({ success: true, product: drafts.toCustomerView(draft, {
    images: await images.listImages(draft.id),
    versions: await drafts.listVersions(draft.id),
    job: await jobs.latestJobForDraft(draft.id),
  }) });
}));

siteAi.post("/sites/:siteId/ai/products/:id/generate", aiGenerateRateLimit(), route(async (req, res) => {
  const queued = await enqueueGeneration(req, {
    type: jobs.JOB_TYPES.GENERATE,
    operation: usage.USAGE_OPERATIONS.PRODUCT_GENERATION,
  });
  res.status(202).json({ success: true, started: queued.created, job: jobs.toJobView(queued.job) });
}));

siteAi.post("/sites/:siteId/ai/products/:id/regenerate", aiGenerateRateLimit(), route(async (req, res) => {
  const section = String(req.body?.section || "content").toLowerCase();
  const allowed = new Set(["content", "title", "description", "seo", "tags", "categories"]);
  if (!allowed.has(section)) throw new AiError(AI_ERROR_CODES.PRODUCT_VALIDATION_ERROR, "Unsupported regeneration section");
  const queued = await enqueueGeneration(req, {
    type: jobs.JOB_TYPES.REGENERATE,
    payload: { section },
    operation: usage.USAGE_OPERATIONS.REGENERATION,
  });
  res.status(202).json({ success: true, started: queued.created, job: jobs.toJobView(queued.job) });
}));

siteAi.patch("/sites/:siteId/ai/products/:id", route(async (req, res) => {
  const draft = await ownedDraft(req);
  const { draft: updated, fields, version } = await drafts.applyEdit(draft.id, req.body || {}, { userId: req.user.id });
  res.json({ success: true, edited_fields: fields, version, product: drafts.toCustomerView(updated, { images: await images.listImages(draft.id) }) });
}));

siteAi.post("/sites/:siteId/ai/products/:id/images", aiUploadRateLimit(), express.raw({ type: ALLOWED_IMAGE_TYPES, limit: config.ai.maxImageBytes }), route(async (req, res) => {
  const draft = await ownedDraft(req);
  let buffer;
  let declaredMimeType = req.get("Content-Type") || "";
  if (Buffer.isBuffer(req.body) && req.body.length) {
    buffer = req.body;
  } else if (req.body?.image) {
    ({ buffer } = decodeBase64Image(req.body.image, { declaredMimeType: req.body.mime_type || "" }));
    declaredMimeType = "";
  } else {
    throw new AiError(AI_ERROR_CODES.IMAGE_VALIDATION_ERROR, "No image payload", { safeMessage: "تصویری ارسال نشده است." });
  }
  const stored = await images.storeImage({
    buffer, userId: req.user.id, siteId: req.site.id, draftId: draft.id,
    origin: "user_upload", declaredMimeType,
    altText: typeof req.query.alt === "string" ? req.query.alt : "",
    position: Number(req.query.position) || 0,
  });
  res.status(201).json({ success: true, image: { id: stored.public_id, width: stored.width, height: stored.height, mime_type: stored.mime_type, byte_size: stored.byte_size, origin: stored.origin } });
}));

siteAi.post("/sites/:siteId/ai/products/:id/images/generate", aiImageRateLimit(), route(async (req, res) => {
  requireAiEnabled();
  const draft = await ownedDraft(req);
  if (!config.ai.enableImageGeneration) throw new AiError(AI_ERROR_CODES.AI_DISABLED, "Image generation disabled", { retryable: false });
  const reservation = await usage.reserveUsage({
    userId: req.user.id, siteId: req.site.id, draftId: draft.id,
    operation: usage.USAGE_OPERATIONS.IMAGE_GENERATION,
    metadata: { purpose: req.body?.purpose || "marketing", trigger: "wordpress_plugin" },
  });
  const queued = await jobs.enqueueJob({
    draftId: draft.id, userId: req.user.id, siteId: req.site.id,
    type: jobs.JOB_TYPES.GENERATE_IMAGE,
    payload: { usage_id: reservation.id, purpose: req.body?.purpose || "marketing", instructions: req.body?.instructions || "", forced: true, source: "wordpress_plugin" },
  });
  if (!queued.created) await usage.releaseUsage(reservation.id, "duplicate_job");
  res.status(202).json({ success: true, started: queued.created, job: jobs.toJobView(queued.job) });
}));

siteAi.post("/sites/:siteId/ai/products/:id/approve", route(async (req, res) => {
  const draft = await ownedDraft(req);
  const approved = await drafts.approveDraft(draft.id, { userId: req.user.id });
  res.json({ success: true, product: drafts.toCustomerView(approved) });
}));

siteAi.post("/sites/:siteId/ai/products/:id/reject", route(async (req, res) => {
  const draft = await ownedDraft(req);
  const rejected = await drafts.rejectDraft(draft.id, { userId: req.user.id, reason: req.body?.reason || "" });
  res.json({ success: true, product: drafts.toCustomerView(rejected) });
}));

siteAi.post("/sites/:siteId/ai/products/:id/publish", aiPublishRateLimit(), route(async (req, res) => {
  const draft = await ownedDraft(req);
  if (draft.status === drafts.DRAFT_STATUS.PUBLISHED && draft.wc_product_id) {
    return res.json({ success: true, already_published: true, product: drafts.toCustomerView(draft) });
  }
  if (![drafts.DRAFT_STATUS.APPROVED, drafts.DRAFT_STATUS.PUBLISHING_FAILED].includes(draft.status)) {
    throw new AiError(AI_ERROR_CODES.CONFLICT, `Draft is ${draft.status}`, { safeMessage: "ابتدا محصول را تایید کنید." });
  }
  const connection = await woocommerce.getConnectionView(draft.site_id);
  if (!connection) throw new AiError(AI_ERROR_CODES.WORDPRESS_AUTH_ERROR, "No WooCommerce connection", { retryable: false, safeMessage: "اتصال ووکامرس تنظیم نشده است." });
  const queued = await jobs.enqueueJob({
    draftId: draft.id, userId: req.user.id, siteId: draft.site_id,
    type: jobs.JOB_TYPES.PUBLISH, payload: { source: "wordpress_plugin" },
    idempotencyKey: req.get("Idempotency-Key") || null,
  });
  res.status(202).json({ success: true, started: queued.created, job: jobs.toJobView(queued.job) });
}));

siteAi.get("/sites/:siteId/ai/jobs/:id", route(async (req, res) => {
  const job = await jobs.getJob(req.params.id, { userId: req.user.id });
  if (!job || (job.site_id && String(job.site_id) !== String(req.site.id))) throw new AiError(AI_ERROR_CODES.NOT_FOUND, "Job not found");
  const draft = job.draft_id ? await drafts.getDraft(job.draft_id, { userId: req.user.id }) : null;
  res.json({ success: true, job: { ...jobs.toJobView(job), result: job.status === "succeeded" ? job.result : null }, product: draft ? drafts.toCustomerView(draft) : null });
}));

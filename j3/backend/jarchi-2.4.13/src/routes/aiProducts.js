import express from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { safeRequestPath } from "../utils/http.js";
import { customerAuth, requireOwnedSite, assertSiteRole } from "../middleware/customerAuth.js";
import {
  apiRateLimit, aiGenerateRateLimit, aiImageRateLimit, aiUploadRateLimit, aiPublishRateLimit,
} from "../middleware/rateLimit.js";
import { AiError, AI_ERROR_CODES, isAiError } from "../ai/errors.js";
import { requireRemoteFeatureForSite } from "../middleware/siteEntitlement.js";
import { requireFeatureForSite } from "../services/entitlements.js";
import { aiAvailable } from "../ai/index.js";
import { ALLOWED_IMAGE_TYPES, decodeBase64Image } from "../ai/image/validation.js";
import * as drafts from "../services/productDrafts.js";
import * as jobs from "../services/productJobs.js";
import * as images from "../services/productImages.js";
import * as usage from "../services/aiUsage.js";
import * as woocommerce from "../services/woocommerce.js";
import { getSettings, saveSettings } from "../services/siteProductSettings.js";

/**
 * Customer API for AI product creation.
 *
 * Route handlers stay thin: authenticate, prove ownership, validate, call a
 * service, shape a response. Every long operation becomes a job and returns
 * immediately with an id the panel can poll.
 *
 * Response shape follows the existing customer API: { success: true, ... } or
 * { success: false, error: "..." }.
 */
export const aiProducts = express.Router();

aiProducts.use(apiRateLimit());

/** Turns a domain error into the customer-facing shape, logging the detail. */
function respondError(req, res, error, context = {}) {
  if (isAiError(error)) {
    logger.warn("ai request rejected", {
      request_id: req.requestId,
      user_id: req.user?.id,
      path: safeRequestPath(req.originalUrl),
      error_code: error.code,
      error: error.detail,
      ...context,
    });
    return res.status(error.status).json(error.toResponse());
  }
  logger.error("ai request failed", {
    request_id: req.requestId, user_id: req.user?.id, path: safeRequestPath(req.originalUrl), error, ...context,
  });
  return res.status(500).json({ success: false, error: "خطای داخلی سرور", error_code: AI_ERROR_CODES.JOB_ERROR });
}

/** Wraps a handler so no rejection escapes as an unhandled error. */
const route = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    respondError(req, res, error);
  }
};

function requireAiEnabled() {
  if (!aiAvailable()) {
    throw new AiError(AI_ERROR_CODES.AI_DISABLED, "AI is not configured", { retryable: false });
  }
}

/** Loads a draft the caller owns, or throws. */
async function ownedDraft(req) {
  const draft = await drafts.getDraft(req.params.id, { userId: req.user.id });
  if (!draft) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Draft ${req.params.id} not found`);
  const access = await assertSiteRole(req.user.id, draft.site_id, ["owner", "admin"]);
  const feature = await requireFeatureForSite(req.user.id, draft.site_id, "remote_products");
  req.site = access.site; req.siteRole = access.role; req.jarchiSubscription = feature;
  return draft;
}

/* ------------------------------------------------------------------ *
 * Status and usage
 * ------------------------------------------------------------------ */

aiProducts.get("/ai/status", customerAuth, route(async (req, res) => {
  res.json({
    success: true,
    ai: {
      available: aiAvailable(),
      image_generation: config.ai.enableImageGeneration,
      default_language: config.ai.defaultLanguage,
      max_images_per_product: config.ai.maxImagesPerDraft,
      max_image_bytes: config.ai.maxImageBytes,
      accepted_image_types: ALLOWED_IMAGE_TYPES,
    },
    usage: await usage.getUsageSummary(req.user.id, undefined, req.query?.site_id || null),
  });
}));

aiProducts.get("/ai/usage", customerAuth, route(async (req, res) => {
  res.json({ success: true, usage: await usage.getUsageSummary(req.user.id, undefined, req.query?.site_id || null) });
}));

/* ------------------------------------------------------------------ *
 * Drafts
 * ------------------------------------------------------------------ */

aiProducts.post("/ai/products", customerAuth, requireRemoteFeatureForSite("remote_products", { roles: ["owner", "admin"] }), aiGenerateRateLimit(), route(async (req, res) => {
  requireAiEnabled();
  const site = await requireOwnedSite(req, res, req.body?.site_id);
  if (!site) return undefined;

  const settings = await getSettings(site.id);
  const { draft, created } = await drafts.createDraft({
    userId: req.user.id,
    siteId: site.id,
    input: req.body?.input || req.body || {},
    language: req.body?.language || settings.language,
    idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotency_key || null,
  });

  // A repeated create with the same key returns the original draft untouched.
  if (!created) {
    return res.json({
      success: true,
      created: false,
      product: drafts.toCustomerView(draft, { job: await jobs.latestJobForDraft(draft.id) }),
    });
  }

  let job = null;
  if (req.body?.generate !== false && settings.auto_generate_content) {
    const reservation = await usage.reserveUsage({
      userId: req.user.id, siteId: site.id, draftId: draft.id,
      operation: usage.USAGE_OPERATIONS.PRODUCT_GENERATION,
      metadata: { trigger: "create" },
    });
    const queued = await jobs.enqueueJob({
      draftId: draft.id, userId: req.user.id, siteId: site.id,
      type: jobs.JOB_TYPES.GENERATE, payload: { usage_id: reservation.id },
    });
    job = queued.job;
    if (!queued.created) await usage.releaseUsage(reservation.id, "duplicate_job");
  }

  return res.status(201).json({
    success: true,
    created: true,
    product: drafts.toCustomerView(draft, { job }),
    job: jobs.toJobView(job),
  });
}));

aiProducts.get("/ai/products", customerAuth, route(async (req, res) => {
  const requestedSite = req.query.site_id ? String(req.query.site_id) : null;
  if (requestedSite) { await assertSiteRole(req.user.id, requestedSite, ["owner", "admin"]); }
  const result = await drafts.listDrafts({
    userId: req.user.id,
    siteId: req.query.site_id || null,
    status: req.query.status || null,
    page: req.query.page,
    pageSize: req.query.page_size,
  });
  res.json({
    success: true,
    products: result.items.map((draft) => drafts.toCustomerView(draft)),
    pagination: result.pagination,
  });
}));

aiProducts.get("/ai/products/:id", customerAuth, route(async (req, res) => {
  const draft = await ownedDraft(req);
  res.json({
    success: true,
    product: drafts.toCustomerView(draft, {
      images: await images.listImages(draft.id),
      versions: await drafts.listVersions(draft.id),
      job: await jobs.latestJobForDraft(draft.id),
    }),
  });
}));

aiProducts.patch("/ai/products/:id", customerAuth, route(async (req, res) => {
  const draft = await ownedDraft(req);
  const { draft: updated, fields, version } = await drafts.applyEdit(draft.id, req.body || {}, { userId: req.user.id });
  res.json({
    success: true,
    edited_fields: fields,
    version,
    product: drafts.toCustomerView(updated, { images: await images.listImages(draft.id) }),
  });
}));

aiProducts.get("/ai/products/:id/versions", customerAuth, route(async (req, res) => {
  const draft = await ownedDraft(req);
  const versions = await drafts.listVersions(draft.id);
  const requested = req.query.version ? await drafts.getVersion(draft.id, req.query.version) : null;
  res.json({ success: true, versions, version: requested });
}));

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

aiProducts.post(
  "/ai/products/:id/images",
  customerAuth,
  aiUploadRateLimit(),
  express.raw({ type: ALLOWED_IMAGE_TYPES, limit: config.ai.maxImageBytes }),
  route(async (req, res) => {
    const draft = await ownedDraft(req);

    // Two accepted shapes: raw image bytes, or base64 in JSON for the Mini App.
    let buffer;
    let declaredMimeType = req.get("Content-Type") || "";
    if (Buffer.isBuffer(req.body) && req.body.length) {
      buffer = req.body;
    } else if (req.body?.image) {
      ({ buffer } = decodeBase64Image(req.body.image, { declaredMimeType: req.body.mime_type || "" }));
      declaredMimeType = "";
    } else {
      throw new AiError(AI_ERROR_CODES.IMAGE_VALIDATION_ERROR, "No image payload", {
        safeMessage: "تصویری ارسال نشده است.",
      });
    }

    const stored = await images.storeImage({
      buffer,
      userId: req.user.id,
      siteId: draft.site_id,
      draftId: draft.id,
      origin: "user_upload",
      declaredMimeType,
      altText: typeof req.query.alt === "string" ? req.query.alt : "",
      position: Number(req.query.position) || 0,
    });

    res.status(201).json({
      success: true,
      image: {
        id: stored.public_id, width: stored.width, height: stored.height,
        mime_type: stored.mime_type, byte_size: stored.byte_size, origin: stored.origin,
      },
    });
  }),
);

aiProducts.delete("/ai/products/:id/images/:imageId", customerAuth, route(async (req, res) => {
  const draft = await ownedDraft(req);
  const image = await images.getImage(req.params.imageId, { userId: req.user.id });
  if (!image || String(image.draft_id) !== String(draft.id)) {
    throw new AiError(AI_ERROR_CODES.NOT_FOUND, "Image not found on this draft");
  }
  await images.deleteImage(image.id);
  res.json({ success: true });
}));

aiProducts.post("/ai/products/:id/images/generate", customerAuth, aiImageRateLimit(), route(async (req, res) => {
  requireAiEnabled();
  const draft = await ownedDraft(req);
  if (!config.ai.enableImageGeneration) {
    throw new AiError(AI_ERROR_CODES.AI_DISABLED, "Image generation disabled", {
      retryable: false, safeMessage: "تولید تصویر در این نصب فعال نیست.",
    });
  }

  const reservation = await usage.reserveUsage({
    userId: req.user.id, siteId: draft.site_id, draftId: draft.id,
    operation: usage.USAGE_OPERATIONS.IMAGE_GENERATION,
    metadata: { purpose: req.body?.purpose || "marketing" },
  });

  const queued = await jobs.enqueueJob({
    draftId: draft.id, userId: req.user.id, siteId: draft.site_id,
    type: jobs.JOB_TYPES.GENERATE_IMAGE,
    payload: {
      usage_id: reservation.id,
      purpose: req.body?.purpose || "marketing",
      instructions: req.body?.instructions || "",
      forced: true,
    },
  });
  if (!queued.created) await usage.releaseUsage(reservation.id, "duplicate_job");

  res.status(202).json({ success: true, job: jobs.toJobView(queued.job), started: queued.created });
}));

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

async function startGeneration(req, res, { type, payload, operation }) {
  requireAiEnabled();
  const draft = await ownedDraft(req);

  const reservation = await usage.reserveUsage({
    userId: req.user.id, siteId: draft.site_id, draftId: draft.id, operation,
    metadata: { type, ...payload },
  });

  const queued = await jobs.enqueueJob({
    draftId: draft.id, userId: req.user.id, siteId: draft.site_id, type,
    payload: { ...payload, usage_id: reservation.id },
  });
  // A job already running for this draft means the credit was not spent here.
  if (!queued.created) await usage.releaseUsage(reservation.id, "duplicate_job");

  res.status(202).json({
    success: true,
    started: queued.created,
    job: jobs.toJobView(queued.job),
    product: drafts.toCustomerView(draft),
  });
}

aiProducts.post("/ai/products/:id/generate", customerAuth, aiGenerateRateLimit(), route(async (req, res) => {
  await startGeneration(req, res, {
    type: jobs.JOB_TYPES.GENERATE,
    payload: {},
    operation: usage.USAGE_OPERATIONS.PRODUCT_GENERATION,
  });
}));

const REGENERATABLE = new Set(["content", "title", "description", "seo", "tags", "categories"]);

aiProducts.post("/ai/products/:id/regenerate", customerAuth, aiGenerateRateLimit(), route(async (req, res) => {
  const section = String(req.body?.section || "content").toLowerCase();
  if (!REGENERATABLE.has(section)) {
    throw new AiError(AI_ERROR_CODES.PRODUCT_VALIDATION_ERROR, `Unknown section: ${section}`, {
      safeMessage: `بخش قابل بازتولید نیست. گزینه‌ها: ${[...REGENERATABLE].join("، ")}`,
    });
  }
  await startGeneration(req, res, {
    type: jobs.JOB_TYPES.REGENERATE,
    payload: { section },
    operation: usage.USAGE_OPERATIONS.REGENERATION,
  });
}));

/* ------------------------------------------------------------------ *
 * Review and publishing
 * ------------------------------------------------------------------ */

aiProducts.post("/ai/products/:id/approve", customerAuth, route(async (req, res) => {
  const draft = await ownedDraft(req);
  const approved = await drafts.approveDraft(draft.id, { userId: req.user.id });
  res.json({ success: true, product: drafts.toCustomerView(approved) });
}));

aiProducts.post("/ai/products/:id/reject", customerAuth, route(async (req, res) => {
  const draft = await ownedDraft(req);
  const rejected = await drafts.rejectDraft(draft.id, { userId: req.user.id, reason: req.body?.reason || "" });
  res.json({ success: true, product: drafts.toCustomerView(rejected) });
}));

aiProducts.post("/ai/products/:id/cancel", customerAuth, route(async (req, res) => {
  const draft = await ownedDraft(req);
  const cancelled = await drafts.cancelDraft(draft.id, { userId: req.user.id });
  const latest = await jobs.latestJobForDraft(draft.id);
  if (latest && ["pending", "processing"].includes(latest.status)) await jobs.cancelJob(latest.id);
  res.json({ success: true, product: drafts.toCustomerView(cancelled) });
}));

aiProducts.post("/ai/products/:id/publish", customerAuth, aiPublishRateLimit(), route(async (req, res) => {
  const draft = await ownedDraft(req);

  // Already published: report the existing product instead of making another.
  if (draft.status === drafts.DRAFT_STATUS.PUBLISHED && draft.wc_product_id) {
    return res.json({
      success: true,
      already_published: true,
      product: drafts.toCustomerView(draft),
    });
  }
  if (draft.status !== drafts.DRAFT_STATUS.APPROVED && draft.status !== drafts.DRAFT_STATUS.PUBLISHING_FAILED) {
    throw new AiError(AI_ERROR_CODES.CONFLICT, `Draft is ${draft.status}`, {
      safeMessage: "ابتدا محصول را تایید کنید.",
    });
  }
  await woocommerce.getConnectionView(draft.site_id).then((connection) => {
    if (!connection) {
      throw new AiError(AI_ERROR_CODES.WORDPRESS_AUTH_ERROR, "No WooCommerce connection", {
        retryable: false, safeMessage: "برای انتشار، ابتدا اتصال ووکامرس این سایت را تنظیم کنید.",
      });
    }
  });

  const queued = await jobs.enqueueJob({
    draftId: draft.id, userId: req.user.id, siteId: draft.site_id,
    type: jobs.JOB_TYPES.PUBLISH,
    payload: {},
    idempotencyKey: req.get("Idempotency-Key") || null,
  });

  return res.status(202).json({
    success: true,
    started: queued.created,
    job: jobs.toJobView(queued.job),
  });
}));

/* ------------------------------------------------------------------ *
 * Jobs
 * ------------------------------------------------------------------ */

aiProducts.get("/ai/jobs/:id", customerAuth, route(async (req, res) => {
  const job = await jobs.getJob(req.params.id, { userId: req.user.id });
  if (!job) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Job ${req.params.id} not found`);

  const draft = job.draft_id ? await drafts.getDraft(job.draft_id, { userId: req.user.id }) : null;
  res.json({
    success: true,
    job: { ...jobs.toJobView(job), result: job.status === "succeeded" ? job.result : null },
    product: draft ? drafts.toCustomerView(draft) : null,
  });
}));

/* ------------------------------------------------------------------ *
 * Site configuration: WooCommerce connection and automation rules
 * ------------------------------------------------------------------ */

aiProducts.get("/sites/:siteId/product-settings", customerAuth, route(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId);
  if (!site) return undefined;
  return res.json({ success: true, settings: await getSettings(site.id) });
}));

aiProducts.put("/sites/:siteId/product-settings", customerAuth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), route(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId);
  if (!site) return undefined;
  const settings = await saveSettings(site.id, req.body || {}, { userId: req.user.id });
  return res.json({ success: true, settings });
}));

aiProducts.get("/sites/:siteId/woocommerce", customerAuth, route(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId);
  if (!site) return undefined;
  // Never includes the key or secret — only status and a masked hint.
  return res.json({ success: true, connection: await woocommerce.getConnectionView(site.id) });
}));

aiProducts.post("/sites/:siteId/woocommerce", customerAuth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), route(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId);
  if (!site) return undefined;

  await woocommerce.saveConnection(site.id, {
    baseUrl: req.body?.base_url || site.wordpress_url,
    consumerKey: req.body?.consumer_key,
    consumerSecret: req.body?.consumer_secret,
    wpUsername: req.body?.wp_username || "",
    wpAppPassword: req.body?.wp_app_password || "",
    siteWordpressUrl: site.wordpress_url,
    userId: req.user.id,
  });

  const test = await woocommerce.testConnection(site.id);
  return res.json({ success: true, connection: await woocommerce.getConnectionView(site.id), test });
}));

aiProducts.post("/sites/:siteId/woocommerce/test", customerAuth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), route(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId);
  if (!site) return undefined;
  return res.json({ success: true, test: await woocommerce.testConnection(site.id) });
}));

aiProducts.delete("/sites/:siteId/woocommerce", customerAuth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), route(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId);
  if (!site) return undefined;
  return res.json({ success: true, removed: await woocommerce.deleteConnection(site.id) });
}));

for (const [path, loader] of [
  ["categories", woocommerce.listCategories],
  ["tags", woocommerce.listTags],
  ["attributes", woocommerce.listAttributes],
]) {
  aiProducts.get(`/sites/:siteId/woocommerce/${path}`, customerAuth, route(async (req, res) => {
    const site = await requireOwnedSite(req, res, req.params.siteId);
    if (!site) return undefined;
    return res.json({ success: true, [path]: await loader(site.id) });
  }));
}

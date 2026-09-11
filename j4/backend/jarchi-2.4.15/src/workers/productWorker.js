import { config } from "../config.js";
import { logger } from "../logger.js";
import { AiError, AI_ERROR_CODES, toAiError } from "../ai/errors.js";
import {
  analyzeProductImages, generateProductContent, generateSeo, generateTaxonomy,
} from "../ai/product/generator.js";
import { promptStamp } from "../ai/prompts/index.js";
import * as jobs from "../services/productJobs.js";
import * as drafts from "../services/productDrafts.js";
import * as images from "../services/productImages.js";
import * as usage from "../services/aiUsage.js";
import { getSettings } from "../services/siteProductSettings.js";
import { publishDraft } from "../services/productPublisher.js";
import * as woocommerce from "../services/woocommerce.js";
import { getAiProvider } from "../ai/index.js";

/**
 * The AI job worker.
 *
 * Everything slow happens here, never inside an HTTP request. Each handler is
 * responsible for leaving the draft in a coherent state and for finalizing the
 * usage reservation it was given — committed when work happened, released when
 * it did not, so a provider outage does not cost the customer a credit.
 */

/** The store's existing taxonomy, so the model reuses instead of inventing. */
async function loadSiteTaxonomy(siteId) {
  try {
    const [categories, tags, attributes] = await Promise.all([
      woocommerce.listCategories(siteId),
      woocommerce.listTags(siteId),
      woocommerce.listAttributes(siteId),
    ]);
    return {
      categories: categories.slice(0, 120).map((category) => ({ id: category.id, name: category.name })),
      tags: tags.slice(0, 150).map((tag) => ({ id: tag.id, name: tag.name })),
      attributes: attributes.slice(0, 40).map((attribute) => ({ id: attribute.id, name: attribute.name })),
    };
  } catch (error) {
    // A store that cannot be read still gets content; it just cannot be matched
    // against existing terms, which the draft records as a warning.
    logger.warn("site taxonomy unavailable for generation", { site_id: siteId, error: error.message });
    return { categories: [], tags: [], attributes: [], unavailable: true };
  }
}

async function handleGenerate(job) {
  const draft = await drafts.getDraft(job.draft_id);
  if (!draft) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Draft ${job.draft_id} vanished`, { retryable: false });

  const context = { job_id: job.public_id, draft_id: draft.public_id, site_id: draft.site_id, user_id: draft.user_id };
  const settings = await getSettings(draft.site_id);

  await drafts.setStatus(draft.id, drafts.DRAFT_STATUS.ANALYZING);
  await jobs.updateProgress(job.id, { step: "analyzing_images" });

  // Vision pass: optional, and a failure degrades to "no observations".
  let analysis = [];
  let analysisModel = null;
  const prepared = await images.loadForAnalysis(draft.id, { max: 3 });
  if (prepared.length) {
    try {
      const result = await analyzeProductImages({
        images: prepared,
        language: draft.language,
        userNotes: draft.input?.instructions || "",
        context,
      });
      analysis = result.analysis;
      analysisModel = result.model;
      await usage.reserveUsage({
        userId: draft.user_id, siteId: draft.site_id, draftId: draft.id, jobId: job.id,
        operation: usage.USAGE_OPERATIONS.IMAGE_ANALYSIS,
        metadata: { images: prepared.length, model: result.model },
      });
      for (const [index, image] of prepared.entries()) {
        await images.saveAnalysis(image.id, analysis[index] || {});
      }
    } catch (error) {
      logger.warn("image analysis failed; continuing without it", { ...context, error: error.message });
    }
  }

  await jobs.updateProgress(job.id, { step: "generating_content" });
  const siteTaxonomy = await loadSiteTaxonomy(draft.site_id);

  const generation = await generateProductContent({
    input: draft.input,
    images: prepared,
    imageAnalysis: analysis,
    siteTaxonomy,
    settings,
    language: draft.language,
    context,
  });

  const warnings = [...generation.warnings];
  if (siteTaxonomy.unavailable) {
    warnings.push({
      field: "categories",
      code: "taxonomy_unavailable",
      message: "دسته‌بندی‌ها و برچسب‌های فروشگاه در دسترس نبود؛ پیشنهادها بدون تطبیق با فروشگاه تولید شد.",
    });
  }
  if (analysisModel) {
    warnings.push({
      field: "images",
      code: "image_derived",
      message: "بخشی از توصیف بر پایه تحلیل تصویر است و ممکن است دقیق نباشد.",
    });
  }

  // Alt texts belong to the images, so store them where the publisher reads them.
  const storedImages = await images.listImages(draft.id);
  for (const [index, image] of storedImages.entries()) {
    const alt = generation.product.image_alt_texts?.[index];
    if (alt && !image.alt_text) await images.setAltText(image.id, alt);
  }

  const nextStatus = settings.require_manual_approval
    ? drafts.DRAFT_STATUS.AWAITING_REVIEW
    : drafts.DRAFT_STATUS.GENERATED;

  const saved = await drafts.saveGeneration(draft.id, {
    content: generation.product,
    source: "ai_generation",
    section: "full",
    provider: generation.provider,
    model: generation.model,
    promptVersion: generation.promptVersion,
    warnings,
    confidence: generation.product.confidence,
    status: nextStatus,
  });

  // Unattended publishing only when the site explicitly asked for it.
  let autoPublishJob = null;
  if (!settings.require_manual_approval && settings.auto_publish) {
    await drafts.setStatus(draft.id, drafts.DRAFT_STATUS.APPROVED);
    const queued = await jobs.enqueueJob({
      draftId: draft.id, userId: draft.user_id, siteId: draft.site_id, type: jobs.JOB_TYPES.PUBLISH,
      payload: { auto: true },
    });
    autoPublishJob = queued.job?.public_id || null;
    logger.info("auto-publish queued by site policy", { ...context, publish_job_id: autoPublishJob });
  }

  return {
    result: {
      version: saved.version,
      status: saved.draft.status,
      warnings: warnings.length,
      auto_publish_job: autoPublishJob,
    },
    usageMeta: { provider: generation.provider, model: generation.model, tokens: generation.usage },
    promptStamp: promptStamp(["product-content", ...(analysis.length ? ["product-analysis"] : [])]),
  };
}

async function handleRegenerate(job) {
  const draft = await drafts.getDraft(job.draft_id);
  if (!draft) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Draft ${job.draft_id} vanished`, { retryable: false });
  if (!draft.generated) {
    throw new AiError(AI_ERROR_CODES.CONFLICT, "Nothing generated yet to regenerate", { retryable: false });
  }

  const section = String(job.payload?.section || "content");
  const context = { job_id: job.public_id, draft_id: draft.public_id, site_id: draft.site_id, section };
  const settings = await getSettings(draft.site_id);
  const siteTaxonomy = await loadSiteTaxonomy(draft.site_id);

  await jobs.updateProgress(job.id, { step: `regenerating_${section}` });

  let generation;
  if (section === "seo") {
    generation = await generateSeo({ product: draft.generated, siteTaxonomy, language: draft.language, context });
  } else if (section === "tags" || section === "categories") {
    generation = await generateTaxonomy({ product: draft.generated, siteTaxonomy, language: draft.language, context });
  } else {
    generation = await generateProductContent({
      input: draft.input,
      images: [],
      imageAnalysis: [],
      siteTaxonomy,
      settings,
      language: draft.language,
      context,
    });
  }

  /*
   * A targeted regeneration writes only its own fields. Everything else — and
   * anything the customer edited by hand — is left exactly as it was.
   */
  const SECTION_FIELDS = {
    title: ["title"],
    description: ["description", "short_description"],
    seo: ["seo_title", "meta_description", "slug", "focus_keyword", "secondary_keywords"],
    tags: ["tags"],
    categories: ["categories"],
    content: null,
  };
  const fields = SECTION_FIELDS[section];
  const content = fields
    ? Object.fromEntries(fields.map((field) => [field, generation.product[field]]))
    : generation.product;

  const saved = await drafts.saveGeneration(draft.id, {
    content,
    source: "regeneration",
    section,
    provider: generation.provider,
    model: generation.model,
    promptVersion: generation.promptVersion,
    warnings: generation.warnings,
    confidence: generation.product.confidence,
    status: settings.require_manual_approval ? drafts.DRAFT_STATUS.AWAITING_REVIEW : drafts.DRAFT_STATUS.GENERATED,
  });

  return {
    result: { version: saved.version, section, fields: fields || "all", preserved: saved.lockedPreserved },
    usageMeta: { provider: generation.provider, model: generation.model, tokens: generation.usage },
  };
}

async function handleGenerateImage(job) {
  const draft = await drafts.getDraft(job.draft_id);
  if (!draft) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Draft ${job.draft_id} vanished`, { retryable: false });

  const settings = await getSettings(draft.site_id);
  if (!settings.auto_generate_images && !job.payload?.forced) {
    throw new AiError(AI_ERROR_CODES.CONFLICT, "Image generation is disabled for this site", {
      retryable: false, safeMessage: "تولید تصویر برای این سایت فعال نیست.",
    });
  }
  if (!config.ai.enableImageGeneration) {
    throw new AiError(AI_ERROR_CODES.AI_DISABLED, "Image generation is disabled in this installation", {
      retryable: false,
    });
  }

  const provider = getAiProvider();
  const { productImageV1 } = await import("../ai/prompts/productImage.v1.js");
  const built = productImageV1.build({
    product: draft.generated || { title: draft.input?.name },
    purpose: job.payload?.purpose || "marketing",
    language: draft.language,
    instructions: job.payload?.instructions || "",
  });

  await jobs.updateProgress(job.id, { step: "generating_image" });
  const generated = await provider.generateImage({ prompt: built.prompt });

  const stored = await images.storeImage({
    buffer: generated.buffer,
    userId: draft.user_id,
    siteId: draft.site_id,
    draftId: draft.id,
    origin: "ai_generated",
    purpose: built.purpose,
    provider: provider.name,
    model: generated.model,
    prompt: built.prompt,
    promptVersion: `${productImageV1.id}@${productImageV1.version}`,
    altText: draft.generated?.title || "",
    position: 90,
  });

  return {
    result: { image_id: stored.public_id, purpose: stored.purpose, model: generated.model },
    usageMeta: { provider: provider.name, model: generated.model, tokens: generated.usage },
  };
}

async function handlePublish(job) {
  const draft = await drafts.getDraft(job.draft_id);
  if (!draft) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Draft ${job.draft_id} vanished`, { retryable: false });

  if (draft.status === drafts.DRAFT_STATUS.PUBLISHED && draft.wc_product_id) {
    // A retry after a successful publish is a no-op, not a second product.
    return { result: { product_id: Number(draft.wc_product_id), already_published: true } };
  }
  if (![drafts.DRAFT_STATUS.APPROVED, drafts.DRAFT_STATUS.PUBLISHING, drafts.DRAFT_STATUS.PUBLISHING_FAILED].includes(draft.status)) {
    throw new AiError(AI_ERROR_CODES.CONFLICT, `Draft is ${draft.status}, not approved`, { retryable: false });
  }

  await drafts.setStatus(draft.id, drafts.DRAFT_STATUS.PUBLISHING);
  await jobs.updateProgress(job.id, { step: "publishing" });

  const published = await publishDraft(draft, { userId: draft.user_id, jobId: job.public_id });
  return { result: published };
}

const HANDLERS = {
  [jobs.JOB_TYPES.GENERATE]: handleGenerate,
  [jobs.JOB_TYPES.REGENERATE]: handleRegenerate,
  [jobs.JOB_TYPES.GENERATE_IMAGE]: handleGenerateImage,
  [jobs.JOB_TYPES.PUBLISH]: handlePublish,
};

/** Draft state to fall back to when a job type fails. */
const FAILURE_STATUS = {
  [jobs.JOB_TYPES.GENERATE]: (error) => (error.code === AI_ERROR_CODES.AI_VALIDATION_ERROR
    ? drafts.DRAFT_STATUS.VALIDATION_FAILED
    : drafts.DRAFT_STATUS.GENERATION_FAILED),
  [jobs.JOB_TYPES.REGENERATE]: () => drafts.DRAFT_STATUS.AWAITING_REVIEW,
  [jobs.JOB_TYPES.GENERATE_IMAGE]: () => null,
  [jobs.JOB_TYPES.PUBLISH]: () => drafts.DRAFT_STATUS.PUBLISHING_FAILED,
};

/** Runs one claimed job to completion, including bookkeeping. */
export async function processJob(job) {
  const started = Date.now();
  const handler = HANDLERS[job.type];
  const reservationId = job.payload?.usage_id || null;

  if (!handler) {
    await jobs.failJob(job.id, new AiError(AI_ERROR_CODES.JOB_ERROR, `No handler for ${job.type}`, { retryable: false }));
    return { ok: false };
  }

  try {
    const outcome = await handler(job);
    await usage.commitUsage(reservationId, {
      provider: outcome.usageMeta?.provider,
      model: outcome.usageMeta?.model,
      tokensIn: outcome.usageMeta?.tokens?.tokens_in ?? null,
      tokensOut: outcome.usageMeta?.tokens?.tokens_out ?? null,
    });
    await jobs.completeJob(job.id, { result: outcome.result, durationMs: Date.now() - started });

    logger.info("ai job completed", {
      job_id: job.public_id, type: job.type, draft_id: job.draft_id, user_id: job.user_id,
      site_id: job.site_id, provider: outcome.usageMeta?.provider, model: outcome.usageMeta?.model,
      duration_ms: Date.now() - started, status: "succeeded",
    });
    return { ok: true, result: outcome.result };
  } catch (error) {
    const aiError = toAiError(error);
    const updated = await jobs.failJob(job.id, aiError, { durationMs: Date.now() - started });
    const finished = updated?.status === "failed";

    if (finished) {
      // Only give the credit back when no further attempt will be made.
      await usage.releaseUsage(reservationId, aiError.code);
      const statusFor = FAILURE_STATUS[job.type]?.(aiError);
      if (statusFor && job.draft_id) {
        await drafts.setStatus(job.draft_id, statusFor, {
          errorCode: aiError.code,
          errorMessage: aiError.safeMessage,
        }).catch((statusError) => logger.warn("could not record draft failure state", {
          job_id: job.public_id, error: statusError.message,
        }));
      }
    }

    logger.error("ai job failed", {
      job_id: job.public_id, type: job.type, draft_id: job.draft_id, user_id: job.user_id,
      site_id: job.site_id, error_code: aiError.code, error: aiError.detail,
      will_retry: !finished, duration_ms: Date.now() - started,
    });
    return { ok: false, error_code: aiError.code, will_retry: !finished };
  }
}

/** Processes one batch of due jobs. */
export async function runProductWorker({ limit = config.ai.worker.batchSize } = {}) {
  await jobs.reclaimStaleJobs();
  const claimed = await jobs.claimJobs(limit);
  if (!claimed.length) return { processed: 0, succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;
  for (const job of claimed) {
    const outcome = await processJob(job);
    if (outcome.ok) succeeded += 1;
    else failed += 1;
  }
  return { processed: claimed.length, succeeded, failed };
}

import crypto from "node:crypto";
import { query, tx } from "../db/db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { AiError, AI_ERROR_CODES } from "../ai/errors.js";
import { sanitizePlainText, sanitizeTerm } from "../ai/sanitize.js";
import { validateProductEdit } from "../ai/schemas/generatedProduct.js";

/**
 * Product drafts: the reviewable unit between "the customer had an idea" and
 * "a product exists in WooCommerce".
 *
 * Lifecycle:
 *   draft → analyzing → generated → awaiting_review → approved → publishing → published
 * Failure states:
 *   generation_failed, validation_failed, approval_rejected, publishing_failed
 * Terminal:
 *   published, cancelled
 */

export const DRAFT_STATUS = Object.freeze({
  DRAFT: "draft",
  ANALYZING: "analyzing",
  GENERATED: "generated",
  AWAITING_REVIEW: "awaiting_review",
  APPROVED: "approved",
  PUBLISHING: "publishing",
  PUBLISHED: "published",
  GENERATION_FAILED: "generation_failed",
  VALIDATION_FAILED: "validation_failed",
  APPROVAL_REJECTED: "approval_rejected",
  PUBLISHING_FAILED: "publishing_failed",
  CANCELLED: "cancelled",
});

/** Allowed transitions. Anything not listed here is refused with a conflict. */
const TRANSITIONS = Object.freeze({
  draft: ["analyzing", "cancelled"],
  analyzing: ["generated", "awaiting_review", "generation_failed", "validation_failed", "cancelled"],
  generated: ["awaiting_review", "approved", "analyzing", "cancelled"],
  awaiting_review: ["approved", "approval_rejected", "analyzing", "cancelled"],
  approved: ["publishing", "analyzing", "awaiting_review", "cancelled"],
  publishing: ["published", "publishing_failed"],
  published: ["analyzing", "publishing"],
  generation_failed: ["analyzing", "cancelled"],
  validation_failed: ["analyzing", "cancelled"],
  approval_rejected: ["analyzing", "awaiting_review", "cancelled"],
  publishing_failed: ["publishing", "approved", "cancelled"],
  cancelled: [],
});

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

const publicId = () => `pd_${crypto.randomBytes(9).toString("base64url")}`;

/** Fields a customer may send when creating a draft. Everything else is dropped. */
function normalizeInput(raw = {}) {
  const input = {};
  const text = (key, maxLength) => {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") return;
    const value = sanitizePlainText(raw[key], { maxLength });
    if (value) input[key] = value;
  };

  text("name", 200);
  text("short_description", 1000);
  text("description", 5000);
  text("category", 120);
  text("keywords", 400);
  text("instructions", 1000);
  text("brand", 120);
  text("color", 60);

  if (raw.sku !== undefined && raw.sku !== null && raw.sku !== "") {
    const sku = String(raw.sku).trim().replace(/[^\w.-]/g, "").slice(0, 64);
    if (sku) input.sku = sku;
  }
  for (const key of ["price", "regular_price", "sale_price"]) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
    const value = Number(String(raw[key]).replace(/[,\s]/g, ""));
    if (Number.isFinite(value) && value >= 0 && value < 1e12) input[key] = value;
  }
  if (raw.stock_quantity !== undefined && raw.stock_quantity !== null && raw.stock_quantity !== "") {
    const value = Number(raw.stock_quantity);
    if (Number.isFinite(value) && value >= 0 && value < 1e9) input.stock_quantity = Math.trunc(value);
  }
  if (raw.manage_stock !== undefined) input.manage_stock = Boolean(raw.manage_stock);

  if (Array.isArray(raw.attributes)) {
    input.attributes = raw.attributes.slice(0, 20).map((attribute) => ({
      name: sanitizeTerm(attribute?.name, { maxLength: 60 }),
      value: sanitizeTerm(attribute?.value, { maxLength: 200 }),
    })).filter((attribute) => attribute.name && attribute.value);
  }

  if (!input.name && !input.description && !input.short_description) {
    throw new AiError(AI_ERROR_CODES.PRODUCT_VALIDATION_ERROR, "A draft needs at least a name or a description", {
      safeMessage: "برای ساخت محصول، حداقل نام یا توضیح کوتاه لازم است.",
    });
  }
  return input;
}

const SHAPE = `id, public_id, user_id, site_id, status, language, input, generated, locked_fields,
  current_version, approved_version, published_version, provider, model, prompt_versions, warnings,
  confidence, wc_product_id, wc_permalink, wc_status, error_code, error_message,
  source_type, source_id, source_key, source_metadata,
  approved_at, published_at, cancelled_at, created_at, updated_at`;

/**
 * Creates a draft.
 * An idempotency key makes a repeated request return the original draft rather
 * than a second one — the customer's panel can retry a timed-out POST safely.
 */
export async function createDraft({ userId, siteId, input, language, idempotencyKey = null, sourceType = "customer", sourceId = null, sourceKey = null, sourceMetadata = {} }) {
  const normalized = normalizeInput(input);
  const key = idempotencyKey ? String(idempotencyKey).slice(0, 100) : null;
  const normalizedSourceType = String(sourceType || "customer").slice(0, 40) || "customer";
  const normalizedSourceId = sourceId === null || sourceId === undefined ? null : String(sourceId).slice(0, 120);
  const normalizedSourceKey = sourceKey === null || sourceKey === undefined || sourceKey === "" ? null : String(sourceKey).slice(0, 200);
  const normalizedSourceMetadata = sourceMetadata && typeof sourceMetadata === "object" && !Array.isArray(sourceMetadata) ? sourceMetadata : {};

  if (key) {
    const existing = (await query(
      `SELECT ${SHAPE} FROM ai_product_drafts WHERE user_id=$1 AND idempotency_key=$2`,
      [Number(userId), key],
    )).rows[0];
    if (existing) return { draft: existing, created: false };
  }

  if (normalizedSourceKey) {
    const existing = (await query(
      `SELECT ${SHAPE} FROM ai_product_drafts WHERE site_id=$1 AND source_type=$2 AND source_key=$3`,
      [siteId, normalizedSourceType, normalizedSourceKey],
    )).rows[0];
    if (existing) return { draft: existing, created: false };
  }

  const row = (await query(
    `INSERT INTO ai_product_drafts(
       public_id, user_id, site_id, status, language, input, idempotency_key,
       source_type, source_id, source_key, source_metadata
     )
     VALUES($1,$2,$3,'draft',$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING ${SHAPE}`,
    [
      publicId(), Number(userId), siteId, language || config.ai.defaultLanguage,
      JSON.stringify(normalized), key, normalizedSourceType, normalizedSourceId,
      normalizedSourceKey, JSON.stringify(normalizedSourceMetadata),
    ],
  )).rows[0];

  if (!row) {
    // Lost a race on either idempotency key. Resolve the winner by whichever
    // identity was supplied so plugin retries remain safe.
    const existing = (await query(
      normalizedSourceKey
        ? `SELECT ${SHAPE} FROM ai_product_drafts WHERE site_id=$1 AND source_type=$2 AND source_key=$3`
        : `SELECT ${SHAPE} FROM ai_product_drafts WHERE user_id=$1 AND idempotency_key=$2`,
      normalizedSourceKey
        ? [siteId, normalizedSourceType, normalizedSourceKey]
        : [Number(userId), key],
    )).rows[0];
    return { draft: existing, created: false };
  }

  logger.info("product draft created", {
    user_id: userId, site_id: siteId, draft_id: row.public_id, has_idempotency_key: Boolean(key),
  });
  return { draft: row, created: true };
}

/** Loads a draft by public or numeric id, scoped to its owner. */
export async function getDraft(id, { userId = null } = {}) {
  const numeric = Number.isFinite(Number(id)) ? Number(id) : 0;
  const row = (await query(
    `SELECT ${SHAPE} FROM ai_product_drafts WHERE (public_id=$1 OR id=$2)`,
    [String(id), numeric],
  )).rows[0];
  if (!row) return null;

  // Ownership is checked here, not by the caller passing a user id into a WHERE
  // clause it might forget.
  if (userId !== null && String(row.user_id) !== String(userId)) {
    throw new AiError(AI_ERROR_CODES.PERMISSION_ERROR, `User ${userId} may not access draft ${row.public_id}`, {
      retryable: false,
    });
  }
  return row;
}

export async function listDrafts({ userId, siteId = null, status = null, page = 1, pageSize = 20 }) {
  const limit = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;

  const rows = (await query(
    `SELECT ${SHAPE} FROM ai_product_drafts
      WHERE user_id=$1
        AND ($2::text IS NULL OR site_id=$2)
        AND ($3::text IS NULL OR status=$3)
      ORDER BY id DESC LIMIT $4 OFFSET $5`,
    [Number(userId), siteId, status, limit, offset],
  )).rows;

  const total = (await query(
    `SELECT COUNT(*)::int AS count FROM ai_product_drafts
      WHERE user_id=$1 AND ($2::text IS NULL OR site_id=$2) AND ($3::text IS NULL OR status=$3)`,
    [Number(userId), siteId, status],
  )).rows[0].count;

  return {
    items: rows,
    pagination: {
      page: Math.max(1, Number(page) || 1),
      page_size: limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

/** Moves a draft between states, refusing transitions the lifecycle forbids. */
export async function setStatus(draftId, status, patch = {}) {
  const current = (await query("SELECT status FROM ai_product_drafts WHERE id=$1", [Number(draftId)])).rows[0];
  if (!current) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Draft ${draftId} not found`);

  if (current.status !== status && !canTransition(current.status, status)) {
    throw new AiError(
      AI_ERROR_CODES.CONFLICT,
      `Illegal draft transition ${current.status} -> ${status}`,
      { retryable: false, safeMessage: "این عملیات در وضعیت فعلی محصول قابل انجام نیست." },
    );
  }

  const row = (await query(
    `UPDATE ai_product_drafts
        SET status=$2,
            error_code=$3,
            error_message=$4,
            wc_product_id=COALESCE($5, wc_product_id),
            wc_permalink=COALESCE($6, wc_permalink),
            wc_status=COALESCE($7, wc_status),
            published_at=CASE WHEN $2='published' THEN NOW() ELSE published_at END,
            cancelled_at=CASE WHEN $2='cancelled' THEN NOW() ELSE cancelled_at END,
            updated_at=NOW()
      WHERE id=$1
      RETURNING ${SHAPE}`,
    [
      Number(draftId), status,
      patch.errorCode ?? null,
      patch.errorMessage ? String(patch.errorMessage).slice(0, 1000) : null,
      patch.wcProductId ?? null,
      patch.wcPermalink ?? null,
      patch.wcStatus ?? null,
    ],
  )).rows[0];
  return row;
}

/**
 * Stores a generation result as a new version and makes it current.
 *
 * Locked fields — anything the customer edited by hand — survive: a regenerated
 * description never overwrites a title the customer wrote.
 */
export async function saveGeneration(draftId, {
  content, source = "ai_generation", section = "full", provider = null, model = null,
  promptVersion = null, warnings = [], confidence = null, userId = null, status = null,
}) {
  return tx(async (client) => {
    const draft = (await client.query(
      "SELECT * FROM ai_product_drafts WHERE id=$1 FOR UPDATE",
      [Number(draftId)],
    )).rows[0];
    if (!draft) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Draft ${draftId} not found`);

    const locked = Array.isArray(draft.locked_fields) ? draft.locked_fields : [];
    if (status && draft.status !== status && !canTransition(draft.status, status)) {
      throw new AiError(AI_ERROR_CODES.CONFLICT, `Illegal draft transition ${draft.status} -> ${status}`, {
        retryable: false, safeMessage: "این عملیات در وضعیت فعلی محصول قابل انجام نیست.",
      });
    }
    const previous = draft.generated || {};
    const merged = { ...previous, ...content };
    for (const field of locked) {
      if (previous[field] !== undefined) merged[field] = previous[field];
    }

    const version = Number(draft.current_version) + 1;
    await client.query(
      `INSERT INTO ai_product_versions(draft_id, version, source, section, content, provider, model, prompt_version, created_by_user_id)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
      [Number(draftId), version, source, section, JSON.stringify(merged), provider, model, promptVersion, userId],
    );

    const promptVersions = { ...(draft.prompt_versions || {}) };
    if (promptVersion) promptVersions[section] = promptVersion;

    const row = (await client.query(
      `UPDATE ai_product_drafts
          SET generated=$2::jsonb,
              current_version=$3,
              provider=COALESCE($4, provider),
              model=COALESCE($5, model),
              prompt_versions=$6::jsonb,
              warnings=$7::jsonb,
              confidence=COALESCE($8, confidence),
              status=COALESCE($9, status),
              error_code=NULL,
              error_message=NULL,
              updated_at=NOW()
        WHERE id=$1
        RETURNING ${SHAPE}`,
      [
        Number(draftId), JSON.stringify(merged), version, provider, model,
        JSON.stringify(promptVersions), JSON.stringify(warnings),
        confidence, status,
      ],
    )).rows[0];

    return { draft: row, version, lockedPreserved: locked };
  });
}

/** A customer edit becomes a version too, and locks the fields it touched. */
export async function applyEdit(draftId, patch, { userId }) {
  const allowed = validateProductEdit(patch);

  return tx(async (client) => {
    const draft = (await client.query("SELECT * FROM ai_product_drafts WHERE id=$1 FOR UPDATE", [Number(draftId)])).rows[0];
    if (!draft) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Draft ${draftId} not found`);
    if ([DRAFT_STATUS.PUBLISHING, DRAFT_STATUS.CANCELLED].includes(draft.status)) {
      throw new AiError(AI_ERROR_CODES.CONFLICT, `Draft is ${draft.status}`, {
        safeMessage: "در وضعیت فعلی امکان ویرایش وجود ندارد.",
      });
    }

    const merged = { ...(draft.generated || {}), ...allowed };
    const locked = new Set([...(Array.isArray(draft.locked_fields) ? draft.locked_fields : []), ...Object.keys(allowed)]);
    const version = Number(draft.current_version) + 1;

    await client.query(
      `INSERT INTO ai_product_versions(draft_id, version, source, section, content, created_by_user_id)
       VALUES($1,$2,'user_edit',$3,$4::jsonb,$5)`,
      [Number(draftId), version, Object.keys(allowed).join(","), JSON.stringify(merged), Number(userId)],
    );

    const row = (await client.query(
      `UPDATE ai_product_drafts
          SET generated=$2::jsonb, current_version=$3, locked_fields=$4::jsonb, updated_at=NOW()
        WHERE id=$1 RETURNING ${SHAPE}`,
      [Number(draftId), JSON.stringify(merged), version, JSON.stringify([...locked])],
    )).rows[0];

    logger.info("product draft edited", {
      draft_id: row.public_id, user_id: userId, fields: Object.keys(allowed), version,
    });
    return { draft: row, version, fields: Object.keys(allowed) };
  });
}

export async function listVersions(draftId) {
  return (await query(
    `SELECT id, version, source, section, provider, model, prompt_version, created_at
       FROM ai_product_versions WHERE draft_id=$1 ORDER BY version DESC`,
    [Number(draftId)],
  )).rows;
}

export async function getVersion(draftId, version) {
  return (await query(
    "SELECT * FROM ai_product_versions WHERE draft_id=$1 AND version=$2",
    [Number(draftId), Number(version)],
  )).rows[0] || null;
}

export async function approveDraft(draftId, { userId }) {
  const draft = (await query("SELECT * FROM ai_product_drafts WHERE id=$1", [Number(draftId)])).rows[0];
  if (!draft) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Draft ${draftId} not found`);
  if (!draft.generated) {
    throw new AiError(AI_ERROR_CODES.CONFLICT, "Draft has no generated content to approve", {
      safeMessage: "ابتدا باید محتوای محصول تولید شود.",
    });
  }
  if (!canTransition(draft.status, DRAFT_STATUS.APPROVED)) {
    throw new AiError(AI_ERROR_CODES.CONFLICT, `Cannot approve from ${draft.status}`, {
      safeMessage: "این محصول در وضعیت قابل تایید نیست.",
    });
  }

  const row = (await query(
    `UPDATE ai_product_drafts
        SET status='approved', approved_at=NOW(), approved_by_user_id=$2,
            approved_version=current_version, updated_at=NOW()
      WHERE id=$1 RETURNING ${SHAPE}`,
    [Number(draftId), Number(userId)],
  )).rows[0];

  logger.info("product draft approved", { draft_id: row.public_id, user_id: userId, version: row.approved_version });
  return row;
}

export async function rejectDraft(draftId, { userId, reason = "" }) {
  const row = await setStatus(draftId, DRAFT_STATUS.APPROVAL_REJECTED, {
    errorCode: "APPROVAL_REJECTED",
    errorMessage: sanitizePlainText(reason, { maxLength: 500 }),
  });
  logger.info("product draft rejected", { draft_id: row.public_id, user_id: userId });
  return row;
}

export async function cancelDraft(draftId, { userId }) {
  const draft = (await query("SELECT status FROM ai_product_drafts WHERE id=$1", [Number(draftId)])).rows[0];
  if (!draft) throw new AiError(AI_ERROR_CODES.NOT_FOUND, `Draft ${draftId} not found`);
  if (draft.status === DRAFT_STATUS.PUBLISHED) {
    throw new AiError(AI_ERROR_CODES.CONFLICT, "A published product cannot be cancelled", {
      safeMessage: "محصول منتشرشده را نمی‌توان لغو کرد.",
    });
  }

  const row = await setStatus(draftId, DRAFT_STATUS.CANCELLED);
  logger.info("product draft cancelled", { draft_id: row.public_id, user_id: userId });
  return row;
}

/** Marks which version actually reached WooCommerce. */
export async function markPublished(draftId, { wcProductId, permalink, wcStatus, version }) {
  return (await query(
    `UPDATE ai_product_drafts
        SET status='published', wc_product_id=$2, wc_permalink=$3, wc_status=$4,
            published_version=$5, published_at=NOW(), error_code=NULL, error_message=NULL, updated_at=NOW()
      WHERE id=$1 RETURNING ${SHAPE}`,
    [Number(draftId), Number(wcProductId), permalink || null, wcStatus || null, version ?? null],
  )).rows[0];
}

/** Customer-facing projection: input, result, warnings and publishing state. */
export function toCustomerView(draft, { images = [], versions = [], job = null } = {}) {
  if (!draft) return null;
  return {
    id: draft.public_id,
    site_id: draft.site_id,
    status: draft.status,
    language: draft.language,
    input: draft.input || {},
    generated: draft.generated || null,
    locked_fields: draft.locked_fields || [],
    warnings: draft.warnings || [],
    confidence: draft.confidence === null ? null : Number(draft.confidence),
    version: draft.current_version,
    approved_version: draft.approved_version,
    published_version: draft.published_version,
    ai: { provider: draft.provider, model: draft.model, prompts: draft.prompt_versions || {} },
    source: { type: draft.source_type || "customer", id: draft.source_id || null, key: draft.source_key || null, metadata: draft.source_metadata || {} },
    wordpress: {
      product_id: draft.wc_product_id,
      permalink: draft.wc_permalink,
      status: draft.wc_status,
      published_at: draft.published_at,
    },
    error: draft.error_code ? { code: draft.error_code, message: draft.error_message } : null,
    images: images.map((image) => ({
      id: image.public_id,
      origin: image.origin,
      purpose: image.purpose,
      status: image.status,
      alt_text: image.alt_text,
      width: image.width,
      height: image.height,
      wp_media_id: image.wp_media_id,
      url: image.wp_source_url,
      analysis: image.analysis || null,
    })),
    versions,
    job: job ? { id: job.public_id, type: job.type, status: job.status, error_code: job.error_code } : null,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
  };
}

import { query } from "../db/db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { sanitizePlainText } from "../ai/sanitize.js";

/**
 * Per-site automation rules.
 *
 * Defaults are deliberately safe: content is generated, but nothing writes to
 * the customer's store, spends image credits, or publishes without a person
 * saying so. Automatic publishing is opt-in and stays opt-in.
 */

const DEFAULTS = Object.freeze({
  language: config.ai.defaultLanguage,
  auto_generate_content: true,
  auto_generate_images: false,
  auto_assign_categories: false,
  auto_generate_tags: true,
  require_manual_approval: true,
  auto_publish: false,
  allow_category_creation: false,
  allow_tag_creation: true,
  replace_original_image: false,
  default_product_status: "draft",
  tone: "",
  extra_instructions: "",
});

const BOOLEAN_FIELDS = [
  "auto_generate_content", "auto_generate_images", "auto_assign_categories",
  "auto_generate_tags", "require_manual_approval", "auto_publish",
  "allow_category_creation", "allow_tag_creation", "replace_original_image",
];

const PRODUCT_STATUSES = new Set(["draft", "pending", "private", "publish"]);
const LANGUAGES = new Set(["fa", "en", "ar", "tr"]);

/** Returns the site's settings, falling back to the safe defaults. */
export async function getSettings(siteId) {
  const row = (await query("SELECT * FROM site_product_settings WHERE site_id=$1", [siteId])).rows[0];
  if (!row) return { site_id: siteId, ...DEFAULTS, is_default: true };
  return { ...row, is_default: false };
}

export async function saveSettings(siteId, patch = {}, { userId = null } = {}) {
  const current = await getSettings(siteId);
  const next = { ...DEFAULTS, ...current };

  for (const field of BOOLEAN_FIELDS) {
    if (patch[field] !== undefined) next[field] = Boolean(patch[field]);
  }
  if (patch.language !== undefined) {
    const language = String(patch.language).toLowerCase().slice(0, 5);
    // Unknown languages are allowed through only if they look like a code;
    // the model is told the code, so this stays open to new languages.
    next.language = LANGUAGES.has(language) || /^[a-z]{2}(-[a-z]{2})?$/.test(language)
      ? language
      : DEFAULTS.language;
  }
  if (patch.default_product_status !== undefined) {
    const status = String(patch.default_product_status).toLowerCase();
    next.default_product_status = PRODUCT_STATUSES.has(status) ? status : "draft";
  }
  if (patch.tone !== undefined) next.tone = sanitizePlainText(patch.tone, { maxLength: 200 });
  if (patch.extra_instructions !== undefined) {
    next.extra_instructions = sanitizePlainText(patch.extra_instructions, { maxLength: 1000 });
  }

  const row = (await query(
    `INSERT INTO site_product_settings(
       site_id, language, auto_generate_content, auto_generate_images, auto_assign_categories,
       auto_generate_tags, require_manual_approval, auto_publish, allow_category_creation,
       allow_tag_creation, replace_original_image, default_product_status, tone,
       extra_instructions, updated_by_user_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT(site_id) DO UPDATE SET
       language=EXCLUDED.language,
       auto_generate_content=EXCLUDED.auto_generate_content,
       auto_generate_images=EXCLUDED.auto_generate_images,
       auto_assign_categories=EXCLUDED.auto_assign_categories,
       auto_generate_tags=EXCLUDED.auto_generate_tags,
       require_manual_approval=EXCLUDED.require_manual_approval,
       auto_publish=EXCLUDED.auto_publish,
       allow_category_creation=EXCLUDED.allow_category_creation,
       allow_tag_creation=EXCLUDED.allow_tag_creation,
       replace_original_image=EXCLUDED.replace_original_image,
       default_product_status=EXCLUDED.default_product_status,
       tone=EXCLUDED.tone,
       extra_instructions=EXCLUDED.extra_instructions,
       updated_by_user_id=EXCLUDED.updated_by_user_id,
       updated_at=NOW()
     RETURNING *`,
    [
      siteId, next.language, next.auto_generate_content, next.auto_generate_images,
      next.auto_assign_categories, next.auto_generate_tags, next.require_manual_approval,
      next.auto_publish, next.allow_category_creation, next.allow_tag_creation,
      next.replace_original_image, next.default_product_status, next.tone,
      next.extra_instructions, userId ? Number(userId) : null,
    ],
  )).rows[0];

  // Turning on unattended publishing is worth a log line of its own.
  if (next.auto_publish && !current.auto_publish) {
    logger.warn("automatic product publishing enabled", { site_id: siteId, user_id: userId });
  }
  logger.info("site product settings saved", { site_id: siteId, user_id: userId });
  return { ...row, is_default: false };
}

export { DEFAULTS as DEFAULT_PRODUCT_SETTINGS };

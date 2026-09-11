import {
  sanitizeGeneratedHtml, sanitizePlainText, sanitizeSlug, sanitizeTerm,
} from "../sanitize.js";
import { SEO_LIMITS, reviewSeo } from "../seo/rules.js";
import { AiError, AI_ERROR_CODES } from "../errors.js";

/**
 * The contract for AI-generated product content.
 *
 * Model output is never trusted. It arrives here as parsed JSON of unknown
 * shape and leaves as a value with known fields, known types, bounded lengths
 * and sanitized text — or it does not leave at all.
 *
 * Two distinct outcomes:
 *  - structurally unusable (not an object, no title) -> throws, the job retries
 *  - usable but imperfect (over-long meta description, weak tags) -> warnings
 *    the customer sees before approving.
 */

const length = (value) => Array.from(String(value ?? "")).length;

/** The JSON Schema handed to providers that support structured output. */
export const GENERATED_PRODUCT_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "title", "short_description", "description", "seo_title", "meta_description",
    "slug", "focus_keyword", "secondary_keywords", "tags", "categories",
    "attributes", "image_alt_texts", "confidence", "warnings",
  ],
  properties: {
    title: { type: "string" },
    short_description: { type: "string" },
    description: { type: "string" },
    seo_title: { type: "string" },
    meta_description: { type: "string" },
    slug: { type: "string" },
    focus_keyword: { type: "string" },
    secondary_keywords: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    categories: { type: "array", items: { type: "string" } },
    attributes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value", "source"],
        properties: {
          name: { type: "string" },
          value: { type: "string" },
          // Where the value came from; "inferred" needs human review.
          source: { type: "string", enum: ["user_provided", "image_analysis", "inferred"] },
        },
      },
    },
    image_prompts: { type: "array", items: { type: "string" } },
    image_alt_texts: { type: "array", items: { type: "string" } },
    suggested_price: { type: ["number", "null"] },
    confidence: { type: "number" },
    warnings: { type: "array", items: { type: "string" } },
  },
});

const asArray = (value) => (Array.isArray(value) ? value : []);

function uniqueTerms(values, { max, maxLength = 60 }) {
  const seen = new Set();
  const result = [];
  for (const value of asArray(values)) {
    const term = sanitizeTerm(value, { maxLength });
    if (!term || length(term) < 2) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(term);
    if (result.length >= max) break;
  }
  return result;
}

/** Prices arrive as numbers or numeric strings; anything else is dropped. */
function normalizePrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/[,\s]/g, ""));
  if (!Number.isFinite(number) || number < 0 || number > 1e12) return null;
  return Math.round(number * 100) / 100;
}

const ATTRIBUTE_SOURCES = new Set(["user_provided", "image_analysis", "inferred"]);

function normalizeAttributes(values, warnings) {
  const result = [];
  for (const entry of asArray(values)) {
    if (!entry || typeof entry !== "object") continue;
    const name = sanitizeTerm(entry.name, { maxLength: 60 });
    const value = sanitizeTerm(entry.value, { maxLength: 200 });
    if (!name || !value) continue;

    const source = ATTRIBUTE_SOURCES.has(entry.source) ? entry.source : "inferred";
    result.push({
      name,
      value,
      source,
      // Anything the model inferred is a suggestion until a human confirms it.
      requires_review: source === "inferred",
    });
    if (result.length >= 30) break;
  }

  const inferred = result.filter((attribute) => attribute.requires_review);
  if (inferred.length) {
    warnings.push({
      field: "attributes",
      code: "inferred_attributes",
      message: `${inferred.length} ویژگی توسط هوش مصنوعی استنباط شده و نیاز به بازبینی دارد.`,
    });
  }
  return result;
}

/**
 * Validates and normalizes one generation result.
 *
 * @param {unknown} raw       parsed model output
 * @param {object}  context   { language, fallbackTitle }
 * @returns {{ product: object, warnings: object[] }}
 */
export function validateGeneratedProduct(raw, context = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AiError(AI_ERROR_CODES.AI_VALIDATION_ERROR, "AI output is not a JSON object");
  }

  const warnings = [];
  const title = sanitizePlainText(raw.title, { maxLength: SEO_LIMITS.title.max });
  if (length(title) < SEO_LIMITS.title.min) {
    throw new AiError(
      AI_ERROR_CODES.AI_VALIDATION_ERROR,
      `AI output has no usable title (got ${JSON.stringify(raw.title ?? null)})`,
    );
  }

  const description = sanitizeGeneratedHtml(raw.description, { maxLength: SEO_LIMITS.description.max });
  if (length(description) < SEO_LIMITS.description.min) {
    warnings.push({ field: "description", code: "thin_description", message: "توضیحات تولیدشده بسیار کوتاه است." });
  }

  const focusKeyword = sanitizeTerm(raw.focus_keyword, { maxLength: SEO_LIMITS.focusKeyword.max });
  const slugSource = raw.slug || focusKeyword || title;
  const slug = sanitizeSlug(slugSource, { maxLength: SEO_LIMITS.slug.max });
  if (!slug) {
    throw new AiError(AI_ERROR_CODES.AI_VALIDATION_ERROR, "AI output produced no usable slug");
  }

  const confidenceRaw = Number(raw.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw))
    : 0.5;

  const product = {
    title,
    short_description: sanitizePlainText(raw.short_description, { maxLength: SEO_LIMITS.shortDescription.max }),
    description,
    seo_title: sanitizePlainText(raw.seo_title, { maxLength: SEO_LIMITS.seoTitle.max }) || title.slice(0, SEO_LIMITS.seoTitle.max),
    meta_description: sanitizePlainText(raw.meta_description, { maxLength: SEO_LIMITS.metaDescription.max }),
    slug,
    focus_keyword: focusKeyword,
    secondary_keywords: uniqueTerms(raw.secondary_keywords, { max: SEO_LIMITS.secondaryKeywords.max }),
    tags: uniqueTerms(raw.tags, { max: SEO_LIMITS.tags.max, maxLength: 40 }),
    categories: uniqueTerms(raw.categories, { max: 5, maxLength: 80 }),
    attributes: normalizeAttributes(raw.attributes, warnings),
    image_prompts: uniqueTerms(raw.image_prompts, { max: 4, maxLength: 400 }),
    image_alt_texts: asArray(raw.image_alt_texts)
      .map((alt) => sanitizePlainText(alt, { maxLength: 140 }))
      .filter(Boolean)
      .slice(0, 10),
    suggested_price: normalizePrice(raw.suggested_price),
    confidence,
    language: String(context.language || "fa"),
  };

  // Model-declared uncertainty is preserved rather than discarded.
  for (const warning of asArray(raw.warnings).slice(0, 20)) {
    const message = sanitizePlainText(warning, { maxLength: 300 });
    if (message) warnings.push({ field: "model", code: "model_warning", message });
  }

  warnings.push(...reviewSeo(product));
  if (confidence < 0.5) {
    warnings.push({ field: "confidence", code: "low_confidence", message: "اطمینان مدل از نتیجه پایین است؛ بازبینی دقیق‌تری لازم است." });
  }

  return { product, warnings };
}

/**
 * Validates a customer's manual edit of generated fields.
 * Same sanitizing as generated content — a customer's HTML is untrusted too.
 */
export function validateProductEdit(patch = {}) {
  const allowed = {};

  if (patch.title !== undefined) allowed.title = sanitizePlainText(patch.title, { maxLength: SEO_LIMITS.title.max });
  if (patch.short_description !== undefined) allowed.short_description = sanitizePlainText(patch.short_description, { maxLength: SEO_LIMITS.shortDescription.max });
  if (patch.description !== undefined) allowed.description = sanitizeGeneratedHtml(patch.description, { maxLength: SEO_LIMITS.description.max });
  if (patch.seo_title !== undefined) allowed.seo_title = sanitizePlainText(patch.seo_title, { maxLength: SEO_LIMITS.seoTitle.max });
  if (patch.meta_description !== undefined) allowed.meta_description = sanitizePlainText(patch.meta_description, { maxLength: SEO_LIMITS.metaDescription.max });
  if (patch.slug !== undefined) allowed.slug = sanitizeSlug(patch.slug, { maxLength: SEO_LIMITS.slug.max });
  if (patch.focus_keyword !== undefined) allowed.focus_keyword = sanitizeTerm(patch.focus_keyword, { maxLength: SEO_LIMITS.focusKeyword.max });
  if (patch.secondary_keywords !== undefined) allowed.secondary_keywords = uniqueTerms(patch.secondary_keywords, { max: SEO_LIMITS.secondaryKeywords.max });
  if (patch.tags !== undefined) allowed.tags = uniqueTerms(patch.tags, { max: SEO_LIMITS.tags.max, maxLength: 40 });
  if (patch.categories !== undefined) allowed.categories = uniqueTerms(patch.categories, { max: 5, maxLength: 80 });
  if (patch.attributes !== undefined) allowed.attributes = normalizeAttributes(patch.attributes, []);
  if (patch.image_alt_texts !== undefined) {
    allowed.image_alt_texts = asArray(patch.image_alt_texts)
      .map((alt) => sanitizePlainText(alt, { maxLength: 140 })).filter(Boolean).slice(0, 10);
  }
  if (patch.suggested_price !== undefined) allowed.suggested_price = normalizePrice(patch.suggested_price);

  if (!Object.keys(allowed).length) {
    throw new AiError(AI_ERROR_CODES.PRODUCT_VALIDATION_ERROR, "No editable fields supplied");
  }
  if (allowed.title !== undefined && length(allowed.title) < SEO_LIMITS.title.min) {
    throw new AiError(AI_ERROR_CODES.PRODUCT_VALIDATION_ERROR, "Title is too short", {
      safeMessage: "عنوان محصول بسیار کوتاه است.",
    });
  }
  return allowed;
}

import { logger } from "../logger.js";
import { AiError, AI_ERROR_CODES } from "../ai/errors.js";
import { matchTerms, matchAttributes } from "../ai/product/taxonomy.js";
import * as woocommerce from "./woocommerce.js";
import * as images from "./productImages.js";
import * as drafts from "./productDrafts.js";
import { getSettings } from "./siteProductSettings.js";

/**
 * Publishes an approved draft into WooCommerce.
 *
 * Idempotency is the whole point of this module. A duplicated publish — a
 * double click, a retried job, a timeout that actually succeeded — must never
 * produce two products. Three independent guards make that true:
 *
 *  1. only one open publish job per draft can exist (partial unique index);
 *  2. a draft that already carries a wc_product_id updates that product;
 *  3. before creating, the store is searched for a product carrying this
 *     draft's id in `_jarchi_draft_id`, which catches the case where the
 *     previous attempt created the product but failed before recording it.
 */

const DRAFT_META_KEY = "_jarchi_draft_id";

/** Resolves AI category/tag suggestions against the store, creating only if allowed. */
async function resolveTaxonomy(siteId, generated, settings) {
  const notes = [];
  const [existingCategories, existingTags, globalAttributes] = await Promise.all([
    woocommerce.listCategories(siteId).catch(() => []),
    woocommerce.listTags(siteId).catch(() => []),
    woocommerce.listAttributes(siteId).catch(() => []),
  ]);

  const categoryMatch = settings.auto_assign_categories
    ? matchTerms(generated.categories || [], existingCategories, {
      allowCreate: settings.allow_category_creation, maxNew: 1, maxTotal: 3,
    })
    : { matched: [], possible: [], create: [], skipped: (generated.categories || []).map((name) => ({ name, reason: "auto_assign_disabled" })) };

  const tagMatch = settings.auto_generate_tags
    ? matchTerms(generated.tags || [], existingTags, {
      allowCreate: settings.allow_tag_creation, maxNew: 5, maxTotal: 10,
    })
    : { matched: [], possible: [], create: [], skipped: [] };

  const categories = [...categoryMatch.matched.map((term) => ({ id: term.id }))];
  for (const term of categoryMatch.create) {
    try {
      const created = await woocommerce.createCategory(siteId, term.name);
      categories.push({ id: created.id });
      notes.push({ type: "category_created", name: created.name });
    } catch (error) {
      notes.push({ type: "category_create_failed", name: term.name, error: error.message });
    }
  }

  const tags = [...tagMatch.matched.map((term) => ({ id: term.id }))];
  for (const term of tagMatch.create) {
    try {
      const created = await woocommerce.createTag(siteId, term.name);
      tags.push({ id: created.id });
      notes.push({ type: "tag_created", name: created.name });
    } catch (error) {
      // A tag that already exists under a different spelling is not fatal.
      notes.push({ type: "tag_create_failed", name: term.name, error: error.message });
    }
  }

  const attributes = matchAttributes(generated.attributes || [], globalAttributes);

  return {
    categories,
    tags,
    attributes,
    notes,
    skipped: [...categoryMatch.skipped, ...tagMatch.skipped],
    possible: [...categoryMatch.possible, ...tagMatch.possible],
  };
}

/**
 * Uploads any draft image that does not yet have a WordPress media id.
 * An image that is already uploaded is reused, so a retry does not duplicate
 * the media library.
 */
async function ensureMedia(siteId, draft, settings) {
  const rows = await images.listImages(draft.id);
  const uploaded = [];

  for (const image of rows) {
    if (image.origin === "ai_generated" && !settings.auto_generate_images) continue;
    if (image.wp_media_id) {
      uploaded.push({ id: image.wp_media_id, alt: image.alt_text, source: image.origin });
      continue;
    }

    try {
      const buffer = await images.readImageBuffer(image);
      const media = await woocommerce.uploadMedia(siteId, {
        buffer,
        filename: `${draft.public_id}-${image.public_id}.${image.mime_type.split("/")[1]}`,
        mimeType: image.mime_type,
        altText: image.alt_text || (draft.generated?.image_alt_texts || [])[uploaded.length] || draft.generated?.title || "",
        title: draft.generated?.title || "",
      });
      await images.markUploaded(image.id, { wpMediaId: media.id, sourceUrl: media.source_url });
      uploaded.push({ id: media.id, alt: image.alt_text, source: image.origin });
    } catch (error) {
      await images.markUploadFailed(image.id, error.message);
      logger.warn("product image upload failed", {
        site_id: siteId, draft_id: draft.public_id, image_id: image.public_id, error: error.message,
      });
      // A product without one of its images is still publishable; a product
      // that never publishes because of an image is not what the customer wants.
    }
  }

  // Generated images never displace the original unless the site asked for it.
  const originals = uploaded.filter((image) => image.source === "user_upload");
  const generated = uploaded.filter((image) => image.source === "ai_generated");
  return settings.replace_original_image && generated.length
    ? [...generated, ...originals]
    : [...originals, ...generated];
}

/** Builds the WooCommerce payload from validated draft content plus input. */
export function buildProductPayload({ draft, taxonomy, media, settings }) {
  const generated = draft.generated || {};
  const input = draft.input || {};

  const price = input.regular_price ?? input.price ?? generated.suggested_price ?? null;
  const payload = {
    name: generated.title,
    slug: generated.slug || undefined,
    type: "simple",
    status: settings.default_product_status || "draft",
    description: generated.description || "",
    short_description: generated.short_description || "",
    categories: taxonomy.categories,
    tags: taxonomy.tags,
    images: media.map((image, index) => ({ id: image.id, position: index, alt: image.alt || generated.title })),
    meta_data: [
      { key: DRAFT_META_KEY, value: draft.public_id },
      { key: "_jarchi_ai_generated", value: "1" },
      { key: "_jarchi_ai_provider", value: String(draft.provider || "") },
      { key: "_jarchi_ai_model", value: String(draft.model || "") },
      { key: "_yoast_wpseo_title", value: generated.seo_title || "" },
      { key: "_yoast_wpseo_metadesc", value: generated.meta_description || "" },
      { key: "_yoast_wpseo_focuskw", value: generated.focus_keyword || "" },
      { key: "rank_math_title", value: generated.seo_title || "" },
      { key: "rank_math_description", value: generated.meta_description || "" },
      { key: "rank_math_focus_keyword", value: generated.focus_keyword || "" },
    ],
  };

  if (price !== null && price !== undefined) payload.regular_price = String(price);
  if (input.sale_price !== undefined) payload.sale_price = String(input.sale_price);
  if (input.sku) payload.sku = input.sku;
  if (input.manage_stock) {
    payload.manage_stock = true;
    payload.stock_quantity = Number(input.stock_quantity || 0);
  }

  const attributes = (taxonomy.attributes || [])
    // Values the model merely inferred are not written to the store as facts.
    .filter((attribute) => !attribute.requires_review)
    .map((attribute, index) => (attribute.scope === "global"
      ? { id: attribute.global_attribute_id, name: attribute.name, position: index, visible: true, options: [attribute.value] }
      : { name: attribute.name, position: index, visible: true, options: [attribute.value] }));
  if (attributes.length) payload.attributes = attributes;

  return payload;
}

/**
 * Publishes (or re-publishes) a draft.
 * @returns {{ product_id, permalink, status, created, notes }}
 */
export async function publishDraft(draft, { userId, jobId = null } = {}) {
  if (!draft?.generated?.title) {
    throw new AiError(AI_ERROR_CODES.PRODUCT_VALIDATION_ERROR, "Draft has no generated content", {
      retryable: false, safeMessage: "محتوای محصول هنوز تولید نشده است.",
    });
  }

  const settings = await getSettings(draft.site_id);
  const started = Date.now();
  const context = { draft_id: draft.public_id, site_id: draft.site_id, user_id: userId, job_id: jobId };

  const taxonomy = await resolveTaxonomy(draft.site_id, draft.generated, settings);
  const media = await ensureMedia(draft.site_id, draft, settings);
  const payload = buildProductPayload({ draft, taxonomy, media, settings });

  // Guard 2: this draft already has a product.
  let existingId = draft.wc_product_id ? Number(draft.wc_product_id) : null;

  // Guard 3: a previous attempt may have created the product without recording it.
  if (!existingId) {
    try {
      const found = await woocommerce.findProductByDraft(draft.site_id, draft.public_id);
      if (found?.id) {
        existingId = Number(found.id);
        logger.warn("adopting product created by a previous publish attempt", {
          ...context, wc_product_id: existingId,
        });
      }
    } catch (error) {
      logger.warn("duplicate-product lookup failed; continuing", { ...context, error: error.message });
    }
  }

  const product = existingId
    ? await woocommerce.updateProduct(draft.site_id, existingId, payload)
    : await woocommerce.createProduct(draft.site_id, payload);

  logger.info("product published to woocommerce", {
    ...context,
    wc_product_id: product.id,
    created: !existingId,
    images: media.length,
    categories: taxonomy.categories.length,
    tags: taxonomy.tags.length,
    duration_ms: Date.now() - started,
  });

  await drafts.markPublished(draft.id, {
    wcProductId: product.id,
    permalink: product.permalink,
    wcStatus: product.status,
    version: draft.current_version,
  });

  return {
    product_id: product.id,
    permalink: product.permalink,
    status: product.status,
    created: !existingId,
    images: media.length,
    notes: [...taxonomy.notes, ...taxonomy.skipped.map((item) => ({ type: "term_skipped", ...item }))],
    duration_ms: Date.now() - started,
  };
}

export { DRAFT_META_KEY, resolveTaxonomy };

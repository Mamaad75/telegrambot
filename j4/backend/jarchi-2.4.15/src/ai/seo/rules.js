/**
 * SEO rules for generated product content.
 *
 * These are guidelines, not gates: a title two characters over the ideal is a
 * warning the customer can see and fix, not a reason to throw away a whole
 * generation. Only structurally invalid values (in schemas/) are rejected.
 *
 * Lengths are counted in characters, which is what matters for Persian and
 * other non-Latin scripts; byte counts would misjudge them badly.
 */

/*
 * `min` is the hard floor for acceptance and is deliberately low: plenty of
 * real product names are short ("چای", "Mac mini"). Quality is expressed by
 * `ideal`, which produces warnings, not rejections.
 */
export const SEO_LIMITS = Object.freeze({
  title: { min: 2, ideal: [20, 70], max: 140 },
  seoTitle: { min: 5, ideal: [30, 60], max: 70 },
  metaDescription: { min: 50, ideal: [110, 160], max: 180 },
  shortDescription: { min: 20, ideal: [80, 400], max: 600 },
  description: { min: 100, ideal: [400, 4000], max: 20000 },
  slug: { min: 3, ideal: [3, 75], max: 120 },
  focusKeyword: { min: 2, ideal: [2, 40], max: 60 },
  tags: { min: 0, ideal: [3, 10], max: 15 },
  secondaryKeywords: { min: 0, ideal: [2, 8], max: 12 },
});

const length = (value) => Array.from(String(value ?? "")).length;

/** Case- and diacritic-tolerant containment check. */
export function containsKeyword(haystack, keyword) {
  const text = String(haystack ?? "").toLowerCase();
  const needle = String(keyword ?? "").toLowerCase().trim();
  if (!needle) return false;
  if (text.includes(needle)) return true;
  // A multi-word keyword also counts when every word appears.
  const words = needle.split(/\s+/).filter((word) => word.length > 2);
  return words.length > 1 && words.every((word) => text.includes(word));
}

/** Rough keyword density as a percentage of total words. */
export function keywordDensity(text, keyword) {
  const words = String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const needle = String(keyword ?? "").toLowerCase().trim();
  if (!words.length || !needle) return 0;
  const occurrences = String(text ?? "").toLowerCase().split(needle).length - 1;
  const keywordWords = Math.max(1, needle.split(/\s+/).length);
  return (occurrences * keywordWords * 100) / words.length;
}

function lengthWarning(field, value, limits, warnings) {
  const size = length(value);
  if (!size) return;
  const [idealMin, idealMax] = limits.ideal;
  if (size < idealMin) {
    warnings.push({ field, code: "too_short", message: `${field} کوتاه‌تر از حد مطلوب است (${size} نویسه، مطلوب ${idealMin}-${idealMax}).` });
  } else if (size > idealMax) {
    warnings.push({ field, code: "too_long", message: `${field} بلندتر از حد مطلوب است (${size} نویسه، مطلوب ${idealMin}-${idealMax}).` });
  }
}

/**
 * Reviews a validated product for SEO quality.
 * Returns warnings only — never mutates and never rejects.
 */
export function reviewSeo(product) {
  const warnings = [];

  lengthWarning("seo_title", product.seo_title, SEO_LIMITS.seoTitle, warnings);
  lengthWarning("meta_description", product.meta_description, SEO_LIMITS.metaDescription, warnings);
  lengthWarning("short_description", product.short_description, SEO_LIMITS.shortDescription, warnings);
  lengthWarning("description", product.description, SEO_LIMITS.description, warnings);
  lengthWarning("slug", product.slug, SEO_LIMITS.slug, warnings);

  const keyword = String(product.focus_keyword || "").trim();
  if (!keyword) {
    warnings.push({ field: "focus_keyword", code: "missing", message: "کلیدواژه اصلی تعیین نشده است." });
  } else {
    for (const [field, haystack] of [
      ["title", product.title],
      ["seo_title", product.seo_title],
      ["meta_description", product.meta_description],
      ["description", product.description],
    ]) {
      if (haystack && !containsKeyword(haystack, keyword)) {
        warnings.push({ field, code: "keyword_missing", message: `کلیدواژه اصلی در ${field} دیده نمی‌شود.` });
      }
    }

    const density = keywordDensity(product.description, keyword);
    if (density > 4) {
      warnings.push({ field: "description", code: "keyword_stuffing", message: `تکرار کلیدواژه در توضیحات زیاد است (${density.toFixed(1)}٪).` });
    }
  }

  const tags = Array.isArray(product.tags) ? product.tags : [];
  if (tags.length < SEO_LIMITS.tags.ideal[0]) {
    warnings.push({ field: "tags", code: "few_tags", message: "تعداد برچسب‌ها کم است." });
  }
  const normalized = tags.map((tag) => String(tag).toLowerCase().trim());
  if (new Set(normalized).size !== normalized.length) {
    warnings.push({ field: "tags", code: "duplicate_tags", message: "برچسب‌های تکراری حذف شدند." });
  }
  const tooShort = tags.filter((tag) => length(tag) < 2);
  if (tooShort.length) {
    warnings.push({ field: "tags", code: "weak_tags", message: "برخی برچسب‌ها بسیار کوتاه یا بی‌معنا هستند." });
  }

  return warnings;
}

/** Text-only guidance handed to the model, so rules live in one place. */
export function seoGuidelines() {
  return {
    seo_title_chars: SEO_LIMITS.seoTitle.ideal,
    meta_description_chars: SEO_LIMITS.metaDescription.ideal,
    short_description_chars: SEO_LIMITS.shortDescription.ideal,
    description_chars: SEO_LIMITS.description.ideal,
    slug_chars: SEO_LIMITS.slug.ideal,
    tags_count: SEO_LIMITS.tags.ideal,
    secondary_keywords_count: SEO_LIMITS.secondaryKeywords.ideal,
    rules: [
      "The focus keyword must read naturally in the title, SEO title, meta description and opening paragraph.",
      "Never repeat the keyword mechanically; keep density under about 3 percent.",
      "Write for a buyer first and a search engine second.",
      "Never state a factual specification (material, dimensions, model, warranty, certification) that is not present in the provided facts.",
      "Structure the long description with headings: introduction, benefits, features, use cases, buying considerations, and an FAQ when useful.",
    ],
  };
}

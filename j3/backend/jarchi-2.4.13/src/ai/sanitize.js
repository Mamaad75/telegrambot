/**
 * Defenses for text that flows into or out of a model.
 *
 * Two directions, both untrusted:
 *  - customer input and store data go *into* a prompt, so they must not be able
 *    to pose as instructions;
 *  - model output comes *out*, so it must not be able to smuggle markup, links
 *    or control characters into WooCommerce.
 */

const CONTROL_CHARACTERS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Phrases that try to re-address the model. Neutralized, not silently kept. */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)/gi,
  /forget\s+(everything|all\s+previous)/gi,
  /you\s+are\s+now\s+(a|an)\s+/gi,
  /system\s*prompt\s*[:=]/gi,
  /\bdeveloper\s+message\b/gi,
  /<\|[^|]*\|>/g,
  /\bBEGIN\s+SYSTEM\b/gi,
  /دستور(ات)?\s+قبلی\s+را\s+نادیده\s+بگیر/gi,
];

/**
 * Prepares free text for inclusion in a prompt as *data*.
 * The result is never concatenated into the system message: callers place it in
 * a JSON payload the prompt explicitly describes as untrusted user content.
 */
export function sanitizePromptText(value, { maxLength = 4000 } = {}) {
  let text = String(value ?? "").replace(CONTROL_CHARACTERS, " ");
  for (const pattern of INJECTION_PATTERNS) {
    text = text.replace(pattern, "[removed]");
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** True when the text looks like an instruction attempt. */
export function looksLikeInjection(value) {
  const text = String(value ?? "");
  return INJECTION_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

const ALLOWED_HTML_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "ul", "ol", "li",
  "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td",
]);

/**
 * Model output destined for a WooCommerce description.
 *
 * WooCommerce renders this HTML, so only a small structural subset survives:
 * no scripts, no styles, no event handlers, no links, no images, no iframes.
 */
export function sanitizeGeneratedHtml(value, { maxLength = 20000 } = {}) {
  let html = String(value ?? "")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  html = html.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (full, tag) => {
    const name = String(tag).toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(name)) return "";
    // Attributes are dropped wholesale: none of the allowed tags need one.
    return full.startsWith("</") ? `</${name}>` : `<${name}>`;
  });

  html = html.replace(/[ \t]+/g, " ").replace(/>\s+</g, "><").trim();
  return html.length > maxLength ? html.slice(0, maxLength) : html;
}

/** Model output destined for a plain-text field (title, meta description, alt). */
export function sanitizePlainText(value, { maxLength = 500 } = {}) {
  const text = String(value ?? "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

/**
 * Slug for a product permalink. Persian and Arabic letters are kept (WordPress
 * handles UTF-8 slugs); everything else becomes hyphen-separated words.
 */
export function sanitizeSlug(value, { maxLength = 120 } = {}) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(CONTROL_CHARACTERS, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLength);
}

/** A short label: tag, category name, attribute name or value. */
export function sanitizeTerm(value, { maxLength = 60 } = {}) {
  return sanitizePlainText(value, { maxLength }).replace(/[<>{}[\]\\|`]/g, "").trim();
}

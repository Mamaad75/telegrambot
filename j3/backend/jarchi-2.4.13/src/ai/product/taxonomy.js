import { sanitizeTerm } from "../sanitize.js";

/**
 * Matches AI-suggested categories and tags against what the store already has.
 *
 * The goal is reuse. An automated pipeline that creates a new term for every
 * near-synonym ruins a catalogue within weeks, so a suggestion only becomes a
 * new term when nothing existing is a credible match *and* the site's settings
 * allow creation.
 */

/** Folds case, Arabic/Persian letter variants and separators. */
export function normalizeTerm(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[يی]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/[‌‏‎]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token overlap, 0..1. Cheap, language-agnostic, good enough for taxonomy. */
export function similarity(a, b) {
  const left = new Set(normalizeTerm(a).split(" ").filter(Boolean));
  const right = new Set(normalizeTerm(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

const STRONG_MATCH = 0.99;   // identical after normalization
const POSSIBLE_MATCH = 0.6;  // same idea, different wording

/**
 * @param {string[]} suggestions  AI-proposed names
 * @param {Array<{id:number,name:string}>} existing  terms already in the store
 * @param {object} options { allowCreate, maxNew, maxTotal }
 * @returns {{ matched, possible, create, skipped }}
 */
export function matchTerms(suggestions, existing = [], { allowCreate = false, maxNew = 1, maxTotal = 10 } = {}) {
  const result = { matched: [], possible: [], create: [], skipped: [] };
  const usedIds = new Set();
  const usedNames = new Set();

  for (const rawSuggestion of suggestions || []) {
    const suggestion = sanitizeTerm(rawSuggestion, { maxLength: 80 });
    if (!suggestion) continue;
    if (result.matched.length + result.create.length >= maxTotal) {
      result.skipped.push({ name: suggestion, reason: "limit_reached" });
      continue;
    }

    const key = normalizeTerm(suggestion);
    if (usedNames.has(key)) continue;
    usedNames.add(key);

    let best = null;
    let bestScore = 0;
    for (const term of existing) {
      const score = similarity(suggestion, term.name);
      if (score > bestScore) {
        bestScore = score;
        best = term;
      }
    }

    if (best && bestScore >= STRONG_MATCH && !usedIds.has(best.id)) {
      usedIds.add(best.id);
      result.matched.push({ id: best.id, name: best.name, suggested: suggestion, score: 1, match: "exact" });
      continue;
    }
    if (best && bestScore >= POSSIBLE_MATCH && !usedIds.has(best.id)) {
      usedIds.add(best.id);
      result.matched.push({
        id: best.id, name: best.name, suggested: suggestion,
        score: Number(bestScore.toFixed(2)), match: "possible",
      });
      result.possible.push({ suggested: suggestion, matched_to: best.name, score: Number(bestScore.toFixed(2)) });
      continue;
    }

    if (allowCreate && result.create.length < maxNew) {
      result.create.push({ name: suggestion });
    } else {
      result.skipped.push({ name: suggestion, reason: allowCreate ? "new_term_limit" : "creation_disabled" });
    }
  }

  return result;
}

/**
 * Attribute mapping: reuse a global WooCommerce attribute when the name lines
 * up, otherwise keep it as a product-level custom attribute.
 */
export function matchAttributes(attributes = [], globalAttributes = []) {
  return attributes.map((attribute) => {
    let best = null;
    let bestScore = 0;
    for (const candidate of globalAttributes) {
      const score = similarity(attribute.name, candidate.name);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (best && bestScore >= POSSIBLE_MATCH) {
      return { ...attribute, global_attribute_id: best.id, global_attribute_name: best.name, scope: "global" };
    }
    return { ...attribute, scope: "custom" };
  });
}

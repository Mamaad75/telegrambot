/**
 * Text normalization helpers.
 *
 * Iranian business data arrives with Persian digits, Arabic letter variants, zero-width
 * non-joiners and inconsistent spacing. Every comparison in the deduplication engine goes
 * through here first so that "کلینیک زیبایی آرمان" and "كلينيك زيبايي ارمان" collapse to
 * the same key.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Convert Persian (U+06F0..) and Arabic-Indic (U+0660..) digits to ASCII. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p >= 0) {
      out += String(p);
      continue;
    }
    const a = ARABIC_DIGITS.indexOf(ch);
    if (a >= 0) {
      out += String(a);
      continue;
    }
    out += ch;
  }
  return out;
}

/** Convert ASCII digits to Persian digits, for display only. */
export function toPersianDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/**
 * Fold Arabic letter variants onto their Persian equivalents and drop diacritics,
 * tatweel and zero-width characters.
 */
export function normalizePersianLetters(input: string): string {
  return input
    .replace(/[يى]/g, 'ی') // ي, ى -> ی
    .replace(/ك/g, 'ک') // ك -> ک
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ -> ا
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/ئ/g, 'ی') // ئ -> ی
    .replace(/[ً-ٰٟۖ-ۭ]/g, '') // harakat
    .replace(/ـ/g, '') // tatweel
    .replace(/[​-‏‪-‮﻿]/g, ' '); // ZWNJ/ZWJ/bidi marks -> space
}

/** Collapse all whitespace runs into a single space and trim. */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Full normalization used for fuzzy comparison: case-folded, punctuation-free. */
export function normalizeText(input: string): string {
  if (!input) return '';
  return collapseWhitespace(
    normalizePersianLetters(normalizeDigits(input))
      .toLowerCase()
      // Includes Persian punctuation (، ؛ ؟ ٪ ٫ ٬ ـ) — without the Persian comma,
      // "اراک،" and "اراک" compare as different tokens and address matching fails.
      .replace(/[«»"'`،؛؟٪٫٬,.\-_/\\()[\]{}!?:•|+*#@~^&=<>]/g, ' '),
  );
}

/**
 * Words that carry no identity: they appear in thousands of Iranian business names and
 * would otherwise make every clinic look like every other clinic.
 */
const NAME_STOPWORDS = new Set([
  // Persian legal / structural
  'شرکت', 'شركت', 'موسسه', 'مؤسسه', 'گروه', 'مجموعه', 'بازرگانی', 'صنایع', 'صنعتی', 'تولیدی',
  'سهامی', 'خاص', 'عام', 'با', 'مسئولیت', 'محدود', 'تعاونی', 'مرکز', 'دفتر', 'نمایندگی',
  'فروشگاه', 'هایپر', 'سوپر', 'آژانس', 'کارگاه', 'مطب', 'دکتر', 'مهندس', 'استاد',
  'و', 'در', 'از', 'به', 'ی', 'های',
  // English legal / structural
  'co', 'inc', 'ltd', 'llc', 'company', 'corp', 'corporation', 'group', 'holding',
  'the', 'and', 'of', 'for', 'shop', 'store', 'agency', 'center', 'centre', 'office',
]);

/**
 * Canonical form of a business name used as a deduplication key.
 * Keeps the meaningful tokens only, sorted for order-insensitive comparison.
 */
export function normalizeBusinessName(name: string): string {
  const tokens = normalizeText(name)
    .split(' ')
    .filter((t) => t.length > 0 && !NAME_STOPWORDS.has(t));
  return tokens.join(' ');
}

/** Order-insensitive key: same tokens in any order produce the same string. */
export function businessNameKey(name: string): string {
  const tokens = normalizeBusinessName(name).split(' ').filter(Boolean);
  return Array.from(new Set(tokens)).sort().join('|');
}

/** Levenshtein distance, iterative with a single row buffer. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/** 0..1 similarity based on edit distance. */
export function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** 0..1 token overlap (Jaccard index). */
export function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(' ').filter(Boolean));
  const sb = new Set(b.split(' ').filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Combined name similarity in 0..1. Token overlap dominates because Persian business names
 * are frequently reordered, edit distance handles typos and transliteration drift.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeBusinessName(a);
  const nb = normalizeBusinessName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return 0.6 * jaccard(na, nb) + 0.4 * levenshteinRatio(na, nb);
}

/** Similarity between two free-form addresses. */
export function addressSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  return 0.7 * jaccard(na, nb) + 0.3 * levenshteinRatio(na, nb);
}

/** URL-safe slug, ASCII only where possible, otherwise a normalized Persian slug. */
export function slugify(input: string): string {
  return normalizeText(input).replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 120) || 'item';
}

/**
 * Reduce a URL to a comparable registrable-ish domain: lower-cased host without `www.`,
 * without protocol, port, path or trailing dot. Returns null when the input is not a URL.
 */
export function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = normalizeDigits(String(url)).trim();
  if (!raw) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const host = new URL(withProto).hostname.toLowerCase().replace(/\.$/, '');
    if (!host || !host.includes('.')) return null;
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/** Normalize a URL for storage: absolute, lower-cased host, no fragment. */
export function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return null;
  }
}

/** Extract an Instagram handle from a URL or an @handle string. */
export function instagramHandle(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const m = raw.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i);
  if (m) return m[1].toLowerCase();
  const at = raw.match(/^@?([A-Za-z0-9._]{2,30})$/);
  return at ? at[1].toLowerCase() : null;
}

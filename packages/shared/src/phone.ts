import { normalizeDigits, toPersianDigits } from './text';

/**
 * Iranian phone number normalization.
 *
 * The same business shows up as 0912 345 6789, +989123456789, 00989123456789 and
 * 9123456789 depending on the source. All of those must resolve to a single canonical
 * E.164 value so deduplication can rely on it — while the original string is never lost.
 */

export const IRAN_COUNTRY_CODE = '98';

export type PhoneKind = 'MOBILE' | 'LANDLINE' | 'UNKNOWN';

export interface NormalizedPhone {
  /** Exactly what the source gave us. Never modified. */
  original: string;
  /** E.164 (`+989123456789`) when the number could be understood, otherwise null. */
  e164: string | null;
  /** National significant number without the country code or trunk prefix. */
  national: string | null;
  /** ISO country code when known. */
  country: string | null;
  kind: PhoneKind;
  valid: boolean;
  /** Why the number was rejected, for the "needs verification" UI state. */
  reason?: string;
}

/** Iranian landline area codes (leading digits of the national number). */
const IRAN_AREA_CODES = [
  '21', '11', '13', '17', '23', '24', '25', '26', '28', '31', '34', '35', '38', '41', '44',
  '45', '51', '54', '56', '58', '61', '66', '71', '74', '76', '77', '81', '83', '84', '86', '87',
];

function digitsOnly(input: string): { digits: string; hadPlus: boolean } {
  const ascii = normalizeDigits(input);
  const hadPlus = /^\s*\+/.test(ascii);
  return { digits: ascii.replace(/\D/g, ''), hadPlus };
}

function classifyIranNational(national: string): PhoneKind {
  if (/^9\d{9}$/.test(national)) return 'MOBILE';
  if (national.length === 10 && IRAN_AREA_CODES.includes(national.slice(0, 2))) return 'LANDLINE';
  return 'UNKNOWN';
}

/**
 * Normalize a raw phone string. Accepts `+98…`, `0098…`, `98…`, `0…` and bare national
 * numbers, in ASCII or Persian digits, with any separators.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountry = 'IR'): NormalizedPhone {
  const original = raw == null ? '' : String(raw);
  const base: NormalizedPhone = {
    original,
    e164: null,
    national: null,
    country: null,
    kind: 'UNKNOWN',
    valid: false,
  };
  if (!original.trim()) return { ...base, reason: 'empty' };

  // An extension marker ("داخلی", "ext", "#") ends the dialable part.
  const trimmed = normalizeDigits(original).split(/(?:داخلی|ext\.?|x|#)/i)[0];
  const { digits, hadPlus } = digitsOnly(trimmed);
  if (!digits) return { ...base, reason: 'no-digits' };

  let rest = digits;
  let isIran = defaultCountry === 'IR';

  if (rest.startsWith('00')) {
    rest = rest.slice(2);
    isIran = rest.startsWith(IRAN_COUNTRY_CODE);
  } else if (hadPlus) {
    isIran = rest.startsWith(IRAN_COUNTRY_CODE);
  }

  if (isIran) {
    // The same number is written +98…, 0098…, 98…, 098… and 0…, and the two prefixes
    // can appear together ("098 912 …"). Peel the country code and the trunk prefix in
    // whichever order they occur, until neither applies.
    //
    // The length >= 12 guard matters: a mobile such as 0982 123 4567 becomes the
    // national number 9821234567, which also starts with "98". Only a string long
    // enough to still hold a full national number after the cut is treated as prefixed.
    for (let pass = 0; pass < 2; pass++) {
      if (rest.startsWith(IRAN_COUNTRY_CODE) && rest.length >= 12) {
        rest = rest.slice(IRAN_COUNTRY_CODE.length);
      } else if (rest.startsWith('0')) {
        rest = rest.replace(/^0+/, '');
      } else {
        break;
      }
    }

    const kind = classifyIranNational(rest);
    if (kind === 'UNKNOWN') {
      // 8-digit landlines without an area code cannot be resolved to a unique number.
      const reason = rest.length === 8 ? 'missing-area-code' : 'unrecognized-iran-format';
      return { ...base, national: rest || null, country: 'IR', reason };
    }
    return {
      original,
      e164: `+${IRAN_COUNTRY_CODE}${rest}`,
      national: rest,
      country: 'IR',
      kind,
      valid: true,
    };
  }

  // Non-Iranian international number: keep it in E.164 if it is plausible.
  if ((hadPlus || digits.startsWith('00')) && rest.length >= 8 && rest.length <= 15) {
    return { original, e164: `+${rest}`, national: rest, country: null, kind: 'UNKNOWN', valid: true };
  }
  return { ...base, reason: 'unrecognized-format' };
}

/** Canonical key used by the deduplication engine. Null means "do not match on phone". */
export function phoneKey(raw: string | null | undefined): string | null {
  const n = normalizePhone(raw);
  return n.valid ? n.e164 : null;
}

export function isIranianMobile(raw: string | null | undefined): boolean {
  return normalizePhone(raw).kind === 'MOBILE';
}

/** Human-readable form: `0912 345 6789` / `086 3333 4444`. */
export function formatPhoneForDisplay(e164: string | null | undefined, persianDigits = false): string | null {
  if (!e164) return null;
  const n = normalizePhone(e164);
  if (!n.valid || !n.national) return e164;
  let out: string;
  if (n.country === 'IR' && n.kind === 'MOBILE') {
    out = `0${n.national.slice(0, 3)} ${n.national.slice(3, 6)} ${n.national.slice(6)}`;
  } else if (n.country === 'IR') {
    out = `0${n.national.slice(0, 2)} ${n.national.slice(2, 6)} ${n.national.slice(6)}`;
  } else {
    out = `+${n.national}`;
  }
  return persianDigits ? toPersianDigits(out) : out;
}

/** `tel:` href for click-to-call on mobile. */
export function telHref(e164: string | null | undefined): string | null {
  return e164 ? `tel:${e164}` : null;
}

/** Pull every plausible phone number out of a block of text (used by the crawler). */
export function extractPhones(text: string): string[] {
  const ascii = normalizeDigits(text);
  const matches = ascii.match(/(?:\+?98|0)?[\s.\-()]?\d[\d\s.\-()]{7,15}\d/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const n = normalizePhone(m);
    if (n.valid && n.e164 && !seen.has(n.e164)) {
      seen.add(n.e164);
      out.push(n.e164);
    }
  }
  return out;
}

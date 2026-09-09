import { describe, expect, it } from 'vitest';
import { extractPhones, formatPhoneForDisplay, isIranianMobile, normalizePhone, phoneKey } from '@baimar/shared';

/**
 * Iranian phone normalization is the backbone of deduplication: if these fail, the same
 * business arrives twice under two spellings of one number.
 */
describe('Iranian phone normalization', () => {
  it('resolves every common mobile format to the same E.164 value', () => {
    const variants = [
      '09123456789',
      '+989123456789',
      '00989123456789',
      '989123456789',
      '9123456789',
      '0912 345 6789',
      '0912-345-6789',
      '(0912) 345 6789',
      '۰۹۱۲۳۴۵۶۷۸۹', // Persian digits
      '٠٩١٢٣٤٥٦٧٨٩', // Arabic-Indic digits
    ];

    for (const variant of variants) {
      const result = normalizePhone(variant);
      expect(result.valid, `${variant} should be valid`).toBe(true);
      expect(result.e164, `${variant} should normalize`).toBe('+989123456789');
      expect(result.kind).toBe('MOBILE');
    }
  });

  it('normalizes landline numbers with an area code', () => {
    for (const variant of ['08633334444', '+988633334444', '00988633334444', '۰۸۶۳۳۳۳۴۴۴۴', '086 3333 4444']) {
      const result = normalizePhone(variant);
      expect(result.valid, variant).toBe(true);
      expect(result.e164).toBe('+988633334444');
      expect(result.kind).toBe('LANDLINE');
    }
  });

  it('never destroys the original value', () => {
    const original = '۰۹۱۲ ۳۴۵ ۶۷۸۹ (دفتر مرکزی)';
    const result = normalizePhone(original);
    expect(result.original).toBe(original);
    expect(result.e164).toBe('+989123456789');
  });

  it('stops at an extension marker', () => {
    expect(normalizePhone('02188889999 داخلی 203').e164).toBe('+982188889999');
    expect(normalizePhone('021-8888-9999 ext. 12').e164).toBe('+982188889999');
  });

  it('refuses to guess when an area code is missing', () => {
    const result = normalizePhone('33334444');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing-area-code');
    expect(result.e164).toBeNull();
  });

  it('rejects empty and nonsense input instead of inventing a number', () => {
    expect(normalizePhone('').valid).toBe(false);
    expect(normalizePhone(null).valid).toBe(false);
    expect(normalizePhone(undefined).valid).toBe(false);
    expect(normalizePhone('بدون شماره').valid).toBe(false);
    expect(normalizePhone('123').valid).toBe(false);
  });

  it('keeps a plausible non-Iranian international number in E.164', () => {
    const result = normalizePhone('+442071838750');
    expect(result.valid).toBe(true);
    expect(result.e164).toBe('+442071838750');
  });

  it('produces a stable deduplication key, or null when unusable', () => {
    expect(phoneKey('0912 345 6789')).toBe(phoneKey('+989123456789'));
    expect(phoneKey('33334444')).toBeNull();
    expect(phoneKey('')).toBeNull();
  });

  it('identifies mobile numbers', () => {
    expect(isIranianMobile('09123456789')).toBe(true);
    expect(isIranianMobile('08633334444')).toBe(false);
  });

  it('formats for display without losing the number', () => {
    expect(formatPhoneForDisplay('+989123456789')).toBe('0912 345 6789');
    expect(formatPhoneForDisplay('+988633334444')).toBe('086 3333 4444');
    expect(formatPhoneForDisplay('+989123456789', true)).toBe('۰۹۱۲ ۳۴۵ ۶۷۸۹');
    expect(formatPhoneForDisplay(null)).toBeNull();
  });

  it('extracts distinct phone numbers from free text', () => {
    const text = 'تماس: ۰۹۱۲۳۴۵۶۷۸۹ یا 021-88889999 — همچنین 09123456789';
    const found = extractPhones(text);
    expect(found).toContain('+989123456789');
    expect(found).toContain('+982188889999');
    // The repeated mobile appears once.
    expect(found.filter((p) => p === '+989123456789')).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/*  Patch 07 — every written form of one Iranian number collapses to one value  */
/* -------------------------------------------------------------------------- */

describe('canonical form across every input style', () => {
  const CANONICAL = '+989121234567';

  const equivalent = [
    '+989121234567',
    '00989121234567',
    '989121234567',
    '09121234567',
    '9121234567',
    '0912-123-4567',
    '0912 123 4567',
    '(0912) 123 4567',
    '0912.123.4567',
    '+98 912 123 4567',
    '+98 (912) 123-4567',
    '098 912 123 4567', // country code and trunk prefix together
    '  09121234567  ',
    '۰۹۱۲۱۲۳۴۵۶۷', // Persian digits
    '٠٩١٢١٢٣٤٥٦٧', // Arabic-Indic digits
    '۰۹۱۲-۱۲۳-۴۵۶۷', // Persian digits with separators
    '09121234567 داخلی 210', // extension
    '09121234567 ext. 4',
  ];

  for (const input of equivalent) {
    it(`normalizes ${JSON.stringify(input)} to ${CANONICAL}`, () => {
      const n = normalizePhone(input);
      expect(n.e164).toBe(CANONICAL);
      expect(n.valid).toBe(true);
      expect(n.kind).toBe('MOBILE');
      // The source string is evidence and is never rewritten.
      expect(n.original).toBe(input);
    });
  }

  it('gives every equivalent form the same deduplication key', () => {
    const keys = new Set(equivalent.map((v) => phoneKey(v)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe(CANONICAL);
  });
});

describe('landlines', () => {
  const cases: Array<[string, string]> = [
    ['021-88888888', '+982188888888'],
    ['۰۲۱ ۸۸۸۸ ۸۸۸۸', '+982188888888'],
    ['+98 21 8888 8888', '+982188888888'],
    ['08633334444', '+988633334444'], // Arak
    // 0098 is Iran's international prefix; 0086 would be China's.
    ['00988633334444', '+988633334444'],
    ['02188888888 داخلی 210', '+982188888888'],
  ];
  for (const [input, expected] of cases) {
    it(`normalizes ${input}`, () => {
      const n = normalizePhone(input);
      expect(n.e164).toBe(expected);
      expect(n.kind).toBe('LANDLINE');
    });
  }
});

describe('numbers that must NOT be accepted', () => {
  // A wrong number in a sales list is worse than a missing one: it wastes a call
  // and, worse, may reach somebody unrelated to the business.
  const rejected: Array<[string, string]> = [
    ['۰۹۱۲۱۲۳۴۵۶۷۸', 'one digit too many'],
    ['0912123456', 'one digit too few'],
    ['1234567890', 'not an Iranian area code or mobile prefix'],
    ['not a phone', 'no digits at all'],
    ['', 'empty'],
    ['۱۲۳۴۵۶۷۸۹۰', 'postal-code shaped'],
  ];
  for (const [input, why] of rejected) {
    it(`rejects ${JSON.stringify(input)} — ${why}`, () => {
      const n = normalizePhone(input);
      expect(n.valid).toBe(false);
      expect(n.e164).toBeNull();
      expect(phoneKey(input)).toBeNull();
      expect(n.reason).toBeTruthy();
    });
  }

  it('reports a missing area code distinctly, so the UI can ask for one', () => {
    expect(normalizePhone('88888888').reason).toBe('missing-area-code');
  });
});

describe('international numbers keep their own country code', () => {
  it('does not treat a Chinese number as Iranian', () => {
    const n = normalizePhone('0086 21 1234 5678');
    expect(n.e164).toBe('+862112345678');
    expect(n.country).not.toBe('IR');
  });

  it('accepts a plain international number', () => {
    expect(normalizePhone('+1 415 555 2671').e164).toBe('+14155552671');
  });
});

describe('extraction from crawled page text', () => {
  it('finds Persian and ASCII numbers and skips a postal code', () => {
    const found = extractPhones('تماس: ۰۹۱۲ ۱۲۳ ۴۵۶۷ یا 021-88888888 — کد پستی 1234567890');
    expect(found).toEqual(['+989121234567', '+982188888888']);
  });

  it('returns each number once however often it appears', () => {
    expect(extractPhones('09121234567 / 0912 123 4567 / +989121234567')).toEqual(['+989121234567']);
  });
});

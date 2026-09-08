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

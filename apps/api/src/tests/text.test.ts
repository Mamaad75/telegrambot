import { describe, expect, it } from 'vitest';
import {
  addressSimilarity,
  businessNameKey,
  extractDomain,
  instagramHandle,
  nameSimilarity,
  normalizeBusinessName,
  normalizeDigits,
  normalizeText,
  normalizeUrl,
} from '@baimar/shared';

describe('Persian text normalization', () => {
  it('folds Persian and Arabic digits to ASCII', () => {
    expect(normalizeDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('folds Arabic letter variants onto their Persian equivalents', () => {
    // ي/ك are the Arabic forms of ی/ک and appear constantly in scraped data.
    expect(normalizeText('كلينيك زيبايي')).toBe(normalizeText('کلینیک زیبایی'));
  });

  it('strips structural words that carry no identity', () => {
    // آ folds to ا: the output is a comparison key, not a display name.
    expect(normalizeBusinessName('شرکت بازرگانی آرمان')).toBe('ارمان');
    expect(normalizeBusinessName('Arman Trading Co')).toBe('arman trading');
  });

  it('produces an order-insensitive key for the same name', () => {
    expect(businessNameKey('کلینیک زیبایی آرمان')).toBe(businessNameKey('آرمان کلینیک زیبایی'));
    expect(businessNameKey('کلینیک آرمان')).not.toBe(businessNameKey('کلینیک سپهر'));
  });

  it('scores name similarity high for the same business and low for different ones', () => {
    expect(nameSimilarity('کلینیک زیبایی آرمان', 'كلينيك زيبايي ارمان')).toBeGreaterThan(0.85);
    expect(nameSimilarity('کلینیک آرمان', 'رستوران باغ ایرانی')).toBeLessThan(0.3);
  });

  it('scores address similarity for the same street written differently', () => {
    expect(addressSimilarity('اراک، خیابان امام خمینی، پلاک ۱۲', 'اراک خیابان امام خمینی پلاک 12')).toBeGreaterThan(0.7);
    expect(addressSimilarity('اراک، خیابان امام', 'تهران، ولیعصر')).toBeLessThan(0.3);
  });

  it('reduces URLs to a comparable domain', () => {
    expect(extractDomain('https://www.Example.IR/contact?x=1')).toBe('example.ir');
    expect(extractDomain('example.ir')).toBe('example.ir');
    expect(extractDomain('not a url')).toBeNull();
    expect(extractDomain(null)).toBeNull();
  });

  it('normalizes URLs and rejects unsupported protocols', () => {
    expect(normalizeUrl('example.ir')).toBe('https://example.ir/');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });

  it('extracts an Instagram handle from either a URL or an @handle', () => {
    expect(instagramHandle('https://instagram.com/Baimar_Agency')).toBe('baimar_agency');
    expect(instagramHandle('@baimar')).toBe('baimar');
    expect(instagramHandle(null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_BUSINESS_VALUE_CONFIG } from '@baimar/shared';
import type { Lead, WebsiteAudit } from '@prisma/client';
import { assessBusinessValue } from './business-value';

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    category: null,
    subcategory: null,
    businessType: null,
    reviewCount: null,
    reviewRating: null,
    services: [],
    products: [],
    websiteDomain: null,
    websiteStatus: 'UNKNOWN',
    instagramUrl: null,
    telegramUrl: null,
    extraPhones: [],
    ...overrides,
  } as unknown as Lead;
}

const audit = (overrides: Partial<WebsiteAudit> = {}): WebsiteAudit =>
  ({ hasEcommerce: false, hasBooking: false, pagesCrawled: 1, ...overrides }) as unknown as WebsiteAudit;

describe('business value assessment', () => {
  it('reports UNKNOWN rather than LOW when nothing is known', () => {
    const result = assessBusinessValue(lead(), null, DEFAULT_BUSINESS_VALUE_CONFIG);
    expect(result.tier).toBe('UNKNOWN');
    expect(result.reasons).toHaveLength(0);
    // The caller must be able to tell the user *what* is missing.
    expect(result.unknownFactors).toContain('reviewCount');
    expect(result.unknownFactors).toContain('category');
  });

  it('is independent of the lead score — a big business with a good site still scores high', () => {
    const result = assessBusinessValue(
      lead({
        category: 'کلینیک زیبایی',
        reviewCount: 640,
        reviewRating: 4.5,
        services: ['لیزر', 'مزوتراپی', 'کاشت مو', 'بوتاکس', 'هایفو', 'فیشیال'],
        websiteDomain: 'example.ir',
        websiteStatus: 'ACTIVE',
        instagramUrl: 'https://instagram.com/example',
      }),
      audit({ pagesCrawled: 8, hasBooking: true }),
      DEFAULT_BUSINESS_VALUE_CONFIG,
    );
    expect(result.tier).toBe('VERY_HIGH');
    expect(result.reasons.map((r) => r.factor)).toContain('reviews');
    expect(result.reasons.map((r) => r.factor)).toContain('category');
  });

  it('never treats a missing review count as zero reviews', () => {
    const withReviews = assessBusinessValue(lead({ category: 'رستوران', reviewCount: 0 }), null, DEFAULT_BUSINESS_VALUE_CONFIG);
    const withoutReviews = assessBusinessValue(lead({ category: 'رستوران' }), null, DEFAULT_BUSINESS_VALUE_CONFIG);

    expect(withReviews.unknownFactors).not.toContain('reviewCount');
    expect(withoutReviews.unknownFactors).toContain('reviewCount');
    // Both score the same, but only one of them claims to know the answer.
    expect(withReviews.score).toBe(withoutReviews.score);
  });

  it('gives every point an explanation a salesperson can read', () => {
    const result = assessBusinessValue(
      lead({ category: 'تولیدی', reviewCount: 120 }),
      null,
      DEFAULT_BUSINESS_VALUE_CONFIG,
    );
    for (const reason of result.reasons) {
      expect(reason.labelFa.length).toBeGreaterThan(0);
      expect(reason.evidence.length).toBeGreaterThan(0);
      expect(reason.points).toBeGreaterThan(0);
    }
  });

  it('produces a size hint only when signals support one', () => {
    expect(assessBusinessValue(lead(), null, DEFAULT_BUSINESS_VALUE_CONFIG).sizeEstimate).toBeNull();

    const big = assessBusinessValue(
      lead({ reviewCount: 300, services: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }),
      audit({ pagesCrawled: 9 }),
      DEFAULT_BUSINESS_VALUE_CONFIG,
    );
    expect(big.sizeEstimate).toContain('بزرگ‌تر از متوسط');
  });

  it('clamps the score to 0..100', () => {
    const result = assessBusinessValue(
      lead({
        category: 'کلینیک زیبایی',
        reviewCount: 5000,
        services: Array.from({ length: 30 }, (_, i) => `s${i}`),
        products: Array.from({ length: 30 }, (_, i) => `p${i}`),
        websiteDomain: 'x.ir',
        websiteStatus: 'ACTIVE',
        instagramUrl: 'https://instagram.com/x',
        extraPhones: ['+989120000001', '+989120000002'],
      }),
      audit({ hasEcommerce: true, hasBooking: true, pagesCrawled: 20 }),
      DEFAULT_BUSINESS_VALUE_CONFIG,
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

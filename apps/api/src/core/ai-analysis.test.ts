import { describe, expect, it } from 'vitest';
import type { Lead } from '@prisma/client';
import { buildSnapshot, parseAiJson } from './ai-analysis';

describe('AI response parsing', () => {
  it('parses a plain JSON object', () => {
    expect(parseAiJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('recovers JSON from a fenced code block', () => {
    expect(parseAiJson('Here you go:\n```json\n{"a":1}\n```\nHope that helps.')).toEqual({ a: 1 });
  });

  it('recovers JSON surrounded by prose', () => {
    expect(parseAiJson('Sure! {"a": 1, "b": "x"} — done.')).toEqual({ a: 1, b: 'x' });
  });

  it('returns null rather than a half-parsed object', () => {
    expect(parseAiJson('not json at all')).toBeNull();
    expect(parseAiJson('[1,2,3]')).toBeNull();
    expect(parseAiJson('')).toBeNull();
  });
});

describe('AI input snapshot', () => {
  const lead = {
    id: 'l1',
    businessName: 'کلینیک نمونه',
    category: null,
    subcategory: null,
    city: null,
    province: null,
    address: null,
    description: null,
    services: [],
    products: [],
    reviewCount: null,
    reviewRating: null,
    instagramUrl: null,
    telegramUrl: null,
    websiteStatus: 'NO_WEBSITE',
    websiteDomain: null,
  } as unknown as Lead;

  it('marks every missing field as unknown instead of omitting or zeroing it', () => {
    const snapshot = buildSnapshot({
      lead,
      audit: null,
      signals: {},
      score: null,
      businessValue: null,
      matches: [],
      services: [],
    }) as Record<string, Record<string, unknown>>;

    expect(snapshot.business.review_count).toBe('نامشخص');
    expect(snapshot.business.review_rating).toBe('نامشخص');
    expect(snapshot.business.category).toBe('نامشخص');
    expect(snapshot.website_audit).toBe('وب‌سایت هنوز بررسی نشده است');
    expect(snapshot.lead_score).toBe('محاسبه نشده');
    expect(snapshot.market_context).toBe('داده تقاضای بازار برای این خدمت موجود نیست');
  });

  it('never includes anything resembling personal search activity', () => {
    const snapshot = JSON.stringify(
      buildSnapshot({ lead, audit: null, signals: {}, score: null, businessValue: null, matches: [], services: [] }),
    );
    expect(snapshot).not.toMatch(/searched|search_history|user_id|visitor/i);
  });
});

import { describe, expect, it } from 'vitest';
import type { Service } from '@prisma/client';
import { levelFor, matchServices, parseRules, pickRecommendations } from './opportunity';
import type { SignalMap } from './signals';

function service(key: string, rules: unknown[], basePriority = 50, nameFa = key): Service {
  return {
    id: `id-${key}`,
    key,
    nameFa,
    nameEn: key,
    descriptionFa: null,
    basePriority,
    isActive: true,
    rules,
    salesAngles: [],
    commonObjections: [],
    objectionResponses: [],
    discoveryQuestions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Service;
}

function signals(...keys: string[]): SignalMap {
  const map: SignalMap = {};
  for (const key of keys) {
    map[key as keyof SignalMap] = {
      signal: key as never,
      value: true,
      evidence: `observed ${key}`,
      confidence: 'FACT',
    };
  }
  return map;
}

const WEBSITE_DESIGN = service('WEBSITE_DESIGN', [
  { requiresAny: ['NO_WEBSITE', 'WEBSITE_BROKEN'], points: 100, reasonFa: 'وب‌سایت ندارد', reasonEn: 'No website' },
]);
const REDESIGN = service('WEBSITE_REDESIGN', [
  { requiresAny: ['OUTDATED_WEBSITE', 'POOR_MOBILE_UX'], excludes: ['NO_WEBSITE'], points: 90, reasonFa: 'سایت قدیمی', reasonEn: 'Outdated' },
]);
const ECOMMERCE = service('ECOMMERCE', [
  { requiresAny: ['NO_ONLINE_STORE'], points: 85, reasonFa: 'فروش آنلاین ندارد', reasonEn: 'No online store' },
]);
const LANDING = service('LANDING_PAGE', [
  { requiresAll: ['ACTIVE_INSTAGRAM'], requiresAny: ['NO_WEBSITE', 'WEAK_CTA'], points: 60, reasonFa: 'ترافیک اجتماعی بدون مقصد', reasonEn: 'Social traffic with no destination' },
]);

const CATALOGUE = [WEBSITE_DESIGN, REDESIGN, ECOMMERCE, LANDING];

describe('opportunity matching', () => {
  it('recommends nothing when no signal fires', () => {
    expect(matchServices({}, CATALOGUE)).toHaveLength(0);
  });

  it('recommends website design for a business with no website', () => {
    const matches = matchServices(signals('NO_WEBSITE'), CATALOGUE);
    expect(matches[0].serviceKey).toBe('WEBSITE_DESIGN');
    expect(matches[0].reasonsFa).toContain('وب‌سایت ندارد');
    // The concrete observation travels with the recommendation.
    expect(matches[0].reasonsFa).toContain('observed NO_WEBSITE');
  });

  it('honours exclusions — a business with no website is never offered a redesign', () => {
    const matches = matchServices(signals('NO_WEBSITE', 'OUTDATED_WEBSITE'), CATALOGUE);
    expect(matches.map((m) => m.serviceKey)).not.toContain('WEBSITE_REDESIGN');
  });

  it('requires every signal in requiresAll', () => {
    // WEAK_CTA alone is not enough for a landing page; it also needs an active Instagram.
    expect(matchServices(signals('WEAK_CTA'), [LANDING])).toHaveLength(0);
    expect(matchServices(signals('WEAK_CTA', 'ACTIVE_INSTAGRAM'), [LANDING])).toHaveLength(1);
  });

  it('ignores inactive services', () => {
    const inactive = { ...WEBSITE_DESIGN, isActive: false } as Service;
    expect(matchServices(signals('NO_WEBSITE'), [inactive])).toHaveLength(0);
  });

  it('adds a market demand boost and explains it', () => {
    const boost = (key: string) =>
      key === 'ECOMMERCE' ? { points: 20, reasonFa: 'تقاضای بازار برای فروشگاه اینترنتی بالاست' } : null;

    const withoutBoost = matchServices(signals('NO_ONLINE_STORE'), [ECOMMERCE])[0];
    const withBoost = matchServices(signals('NO_ONLINE_STORE'), [ECOMMERCE], boost)[0];

    expect(withBoost.score).toBe(withoutBoost.score + 20);
    expect(withBoost.marketBoost).toBe(20);
    expect(withBoost.reasonsFa).toContain('تقاضای بازار برای فروشگاه اینترنتی بالاست');
  });

  it('picks a primary and only offers secondaries that solve a different problem', () => {
    const matches = matchServices(signals('NO_WEBSITE', 'ACTIVE_INSTAGRAM', 'NO_ONLINE_STORE'), CATALOGUE);
    const { primary, secondary } = pickRecommendations(matches);

    expect(primary?.serviceKey).toBe('WEBSITE_DESIGN');
    expect(secondary.length).toBeGreaterThan(0);
    expect(secondary.map((s) => s.serviceKey)).not.toContain('WEBSITE_DESIGN');
  });

  it('maps scores to levels', () => {
    expect(levelFor(120)).toBe('VERY_HIGH');
    expect(levelFor(80)).toBe('HIGH');
    expect(levelFor(50)).toBe('MEDIUM');
    expect(levelFor(10)).toBe('LOW');
  });

  it('ignores malformed rules stored in the database', () => {
    expect(parseRules(null)).toEqual([]);
    expect(parseRules('not an array')).toEqual([]);
    expect(parseRules([{ points: 'ten' }, { points: 10, reasonFa: 'ok' }])).toHaveLength(1);
  });

  it('never fires a rule that has no positive condition', () => {
    const bad = service('BAD', [{ excludes: ['NO_WEBSITE'], points: 50, reasonFa: 'x', reasonEn: 'x' }]);
    expect(matchServices(signals('ACTIVE_INSTAGRAM'), [bad])).toHaveLength(0);
  });
});

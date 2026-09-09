import { describe, expect, it } from 'vitest';
import type { AIAnalysis, Lead, Service, WebsiteAudit } from '@prisma/client';
import { buildSalesBrief } from './sales-brief';
import type { SignalMap } from './signals';
import type { ScoreResult } from './scoring';
import type { BusinessValueResult } from './business-value';
import type { ServiceMatch } from './opportunity';

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    businessName: 'کلینیک زیبایی نمونه',
    city: 'اراک',
    category: 'کلینیک زیبایی',
    websiteStatus: 'NO_WEBSITE',
    websiteDomain: null,
    instagramUrl: null,
    reviewCount: null,
    reviewRating: null,
    services: [],
    ...overrides,
  } as unknown as Lead;
}

function signalMap(entries: Record<string, string>): SignalMap {
  const map: SignalMap = {};
  for (const [key, evidence] of Object.entries(entries)) {
    map[key as keyof SignalMap] = { signal: key as never, value: true, evidence, confidence: 'FACT' };
  }
  return map;
}

const score: ScoreResult = {
  score: 78,
  temperature: 'WARM',
  contributions: [],
  groups: [],
  rawTotal: 78,
  configHash: 'abc',
  summary: '',
};

const businessValue: BusinessValueResult = {
  score: 55,
  tier: 'HIGH',
  reasons: [],
  unknownFactors: [],
  sizeEstimate: null,
};

const primary: ServiceMatch = {
  serviceId: 's1',
  serviceKey: 'WEBSITE_DESIGN',
  nameFa: 'طراحی وب‌سایت',
  nameEn: 'Website design',
  score: 100,
  level: 'VERY_HIGH',
  reasonsFa: ['وب‌سایتی برای این کسب‌وکار پیدا نشد'],
  reasonsEn: ['No website'],
  marketBoost: 0,
  matchedRules: 1,
  factors: [],
};

const service: Service = {
  key: 'WEBSITE_DESIGN',
  nameFa: 'طراحی وب‌سایت',
  salesAngles: ['تبدیل مخاطب اینستاگرام به مشتری'],
  commonObjections: ['ما فقط با اینستاگرام کار می‌کنیم.'],
  objectionResponses: ['اینستاگرام کانال خوبی است اما جست‌وجوی نام شما به جایی نمی‌رسد.'],
  discoveryQuestions: ['مشتری‌ها چطور با شما تماس می‌گیرند؟'],
} as unknown as Service;

/**
 * Convenience wrapper for the newer tests: a complete, valid brief input with only the
 * fields a given test cares about overridden.
 */
function briefInput(overrides: Partial<Parameters<typeof buildSalesBrief>[0]>): Parameters<typeof buildSalesBrief>[0] {
  return {
    lead: lead(),
    audit: null,
    signals: {},
    score,
    businessValue,
    primary,
    secondary: [],
    services: [service],
    ...overrides,
  };
}

describe('sales brief generation', () => {
  it('produces a complete brief with no AI provider at all', () => {
    const brief = buildSalesBrief({
      lead: lead({ instagramUrl: 'https://instagram.com/x', reviewCount: 184, reviewRating: 4.6 }),
      audit: null,
      signals: signalMap({
        NO_WEBSITE: 'No website was found for this business after discovery.',
        ACTIVE_INSTAGRAM: 'Public Instagram profile',
      }),
      score,
      businessValue,
      primary,
      secondary: [],
      services: [service],
    });

    expect(brief.generatedBy).toBe('RULES');
    expect(brief.whyContactFa.length).toBeGreaterThan(20);
    expect(brief.keyProblemsFa.length).toBeGreaterThan(0);
    expect(brief.openings.length).toBeGreaterThan(0);
    expect(brief.questionsFa.length).toBeGreaterThan(0);
    expect(brief.objections.length).toBeGreaterThan(0);
    expect(brief.nextActionFa.length).toBeGreaterThan(0);
  });

  it('refuses to invent a hook when nothing has been observed', () => {
    const brief = buildSalesBrief({
      lead: lead({ websiteStatus: 'UNKNOWN' }),
      audit: null,
      signals: {},
      score: null,
      businessValue: null,
      primary: null,
      secondary: [],
      services: [],
    });

    expect(brief.whyContactFa).toContain('هنوز داده کافی');
    expect(brief.keyProblemsFa).toHaveLength(0);
    // It still gives the salesperson something honest to say.
    expect(brief.openings[0].textFa).toContain('چند سؤال کوتاه');
    expect(brief.disclaimersFa.join(' ')).toContain('بررسی وب‌سایت هنوز انجام نشده');
  });

  it('only offers an audit-based opening when an audit actually exists', () => {
    const withoutAudit = buildSalesBrief({
      lead: lead(),
      audit: null,
      signals: signalMap({ NO_WEBSITE: 'no website' }),
      score,
      businessValue,
      primary,
      secondary: [],
      services: [service],
    });
    expect(withoutAudit.openings.some((o) => o.style === 'AUDIT')).toBe(false);

    const withAudit = buildSalesBrief({
      lead: lead({ websiteStatus: 'ACTIVE', websiteDomain: 'example.ir' }),
      audit: {
        reachable: true,
        overallScore: 52,
        mobileScore: 40,
        seoScore: 60,
        conversionScore: 30,
        performanceScore: 55,
        uxScore: 50,
        finalUrl: 'https://example.ir',
        findings: [],
        unavailable: [],
      } as unknown as WebsiteAudit,
      signals: signalMap({ POOR_MOBILE_UX: 'Mobile score 40/100' }),
      score,
      businessValue,
      primary,
      secondary: [],
      services: [service],
    });
    expect(withAudit.openings.some((o) => o.style === 'AUDIT')).toBe(true);
  });

  it('deduplicates problems phrased differently by the signal and the audit finding', () => {
    const brief = buildSalesBrief({
      lead: lead({ websiteStatus: 'ACTIVE' }),
      audit: {
        reachable: true,
        overallScore: 50,
        findings: [
          { severity: 'HIGH', area: 'CONVERSION', titleFa: 'امکان رزرو آنلاین ندارد', evidence: 'no booking flow', code: 'x', confidence: 'FACT' },
        ],
        unavailable: [],
      } as unknown as WebsiteAudit,
      signals: signalMap({ NO_ONLINE_BOOKING: 'امکان رزرو یا نوبت‌دهی آنلاین ندارد' }),
      score,
      businessValue,
      primary,
      secondary: [],
      services: [service],
    });

    const bookingProblems = brief.keyProblemsFa.filter((p) => p.includes('رزرو'));
    expect(bookingProblems).toHaveLength(1);
  });

  it('marks the brief HYBRID and labels AI content when an analysis exists', () => {
    const ai = {
      whyContact: 'دلیل تماس تولیدشده توسط مدل',
      mainDigitalProblems: ['مشکل اول', 'مشکل دوم'],
      salesAngle: 'زاویه فروش مدل',
      recommendedOpening: 'جمله شروع مدل',
      recommendedQuestions: ['سؤال مدل'],
      likelyObjections: ['اعتراض مدل'],
      objectionStrategy: 'پاسخ مدل',
      recommendedNextStep: 'اقدام بعدی مدل',
      recommendedService: 'WEBSITE_DESIGN',
      secondaryServices: [],
    } as unknown as AIAnalysis;

    const brief = buildSalesBrief({
      lead: lead(),
      audit: null,
      signals: signalMap({ NO_WEBSITE: 'no website' }),
      score,
      businessValue,
      primary,
      secondary: [],
      services: [service],
      ai,
    });

    expect(brief.generatedBy).toBe('HYBRID');
    expect(brief.whyContactFa).toBe('دلیل تماس تولیدشده توسط مدل');
    expect(brief.openings[0].textFa).toBe('جمله شروع مدل');
    expect(brief.disclaimersFa.join(' ')).toContain('مدل زبانی');
  });

  it('warns the user when the website URL was only guessed', () => {
    const brief = buildSalesBrief({
      lead: lead({ websiteStatus: 'NOT_VERIFIED', websiteDomain: 'guess.ir' }),
      audit: null,
      signals: {},
      score,
      businessValue,
      primary: null,
      secondary: [],
      services: [],
    });
    expect(brief.disclaimersFa.join(' ')).toContain('نیاز به تأیید انسانی');
  });

  it('sets the next action from the lead temperature', () => {
    const hot = buildSalesBrief({
      lead: lead(),
      audit: null,
      signals: signalMap({ NO_WEBSITE: 'x' }),
      score: { ...score, temperature: 'HOT' },
      businessValue,
      primary,
      secondary: [],
      services: [service],
    });
    expect(hot.nextActionFa).toContain('همین امروز');
  });
});

/* -------------------------------------------------------------------------- */
/*  Patch 23-25 — evidence, fact-based openings, and a concrete next action     */
/* -------------------------------------------------------------------------- */

describe('every claim carries its evidence (patch 23)', () => {
  it('attaches evidence, a source and a confidence label to each problem', () => {
    const brief = buildSalesBrief(
      briefInput({
        signals: {
          POOR_MOBILE_UX: { signal: 'POOR_MOBILE_UX', value: true, evidence: 'تگ viewport در صفحه اصلی وجود ندارد', confidence: 'FACT' },
        },
      }),
    );

    expect(brief.keyProblems.length).toBeGreaterThan(0);
    for (const claim of brief.keyProblems) {
      expect(claim.textFa).toBeTruthy();
      expect(claim.evidenceFa).toBeTruthy();
      expect(claim.sourceFa).toBeTruthy();
      expect(claim.confidence).toBeTruthy();
    }
    const mobile = brief.keyProblems.find((c) => c.textFa.includes('موبایل'));
    expect(mobile?.evidenceFa).toContain('viewport');
  });

  it('attributes "no website" to the discovery step, not to reading their site', () => {
    const brief = buildSalesBrief(
      briefInput({
        signals: { NO_WEBSITE: { signal: 'NO_WEBSITE', value: true, evidence: 'هیچ دامنه‌ای یافت نشد', confidence: 'CALCULATED' } },
      }),
    );
    const claim = brief.keyProblems.find((c) => c.textFa.includes('وب‌سایتی'));
    // There was no website to read, so the source cannot be "their website".
    expect(claim?.sourceFa).not.toContain('وب‌سایت رسمی');
    expect(claim?.confidence).toBe('CALCULATED');
  });
});

describe('openings never imply an observation we do not have (patch 24)', () => {
  it('marks an opening built on a real finding as fact-based, with what it rests on', () => {
    const brief = buildSalesBrief(
      briefInput({
        signals: { NO_SSL: { signal: 'NO_SSL', value: true, evidence: 'سایت روی http سرو می‌شود', confidence: 'FACT' } },
      }),
    );
    const opening = brief.openings[0];
    expect(opening.factBased).toBe(true);
    expect(opening.basedOnFa.length).toBeGreaterThan(0);
    expect(opening.basedOnFa[0]).toContain('http');
  });

  it('falls back to a neutral question — not an invented fact — when nothing was observed', () => {
    const brief = buildSalesBrief(briefInput({ signals: {}, audit: null }));
    expect(brief.openings).toHaveLength(1);
    expect(brief.openings[0].style).toBe('NEUTRAL');
    expect(brief.openings[0].factBased).toBe(false);
    expect(brief.openings[0].basedOnFa).toHaveLength(0);
    // The sentence asks; it does not assert.
    expect(brief.openings[0].textFa).toContain('چند سؤال کوتاه');
  });

  it('never claims traffic, revenue or visitor numbers, which no source gives us', () => {
    const brief = buildSalesBrief(
      briefInput({
        signals: { POOR_PERFORMANCE: { signal: 'POOR_PERFORMANCE', value: true, evidence: 'صفحه اصلی ۲.۹ مگابایت است', confidence: 'FACT' } },
      }),
    );
    const allText = [brief.whyContactFa, ...brief.openings.map((o) => o.textFa), ...brief.keyProblemsFa].join(' ');
    for (const forbidden of ['بازدید ماهانه', 'درآمد', 'ترافیک سایت شما', 'فروش شما']) {
      expect(allText).not.toContain(forbidden);
    }
  });
});

describe('the action plan is concrete (patch 25)', () => {
  it('gives a hot lead a same-day action and a dated follow-up', () => {
    const brief = buildSalesBrief(
      briefInput({
        score: {
          score: 88,
          temperature: 'HOT',
          contributions: [],
          groups: [],
          rawTotal: 88,
          configHash: 'x',
          summary: 'داغ',
        },
      }),
    );
    expect(brief.nextActionFa).toContain('همین امروز');
    expect(brief.suggestedFollowUpAt).toBeTruthy();

    const at = new Date(brief.suggestedFollowUpAt!);
    const days = (at.getTime() - Date.now()) / (24 * 3600 * 1000);
    // A hot lead comes back within days, not weeks — the observation behind it goes stale.
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThan(5);
  });

  it('always offers questions and objections to work with', () => {
    const brief = buildSalesBrief(briefInput({}));
    expect(brief.questionsFa.length).toBeGreaterThanOrEqual(1);
    expect(brief.objections.length).toBeGreaterThanOrEqual(1);
    for (const o of brief.objections) expect(o.responseFa).toBeTruthy();
  });
});

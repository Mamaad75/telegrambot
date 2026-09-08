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
};

const service: Service = {
  key: 'WEBSITE_DESIGN',
  nameFa: 'طراحی وب‌سایت',
  salesAngles: ['تبدیل مخاطب اینستاگرام به مشتری'],
  commonObjections: ['ما فقط با اینستاگرام کار می‌کنیم.'],
  objectionResponses: ['اینستاگرام کانال خوبی است اما جست‌وجوی نام شما به جایی نمی‌رسد.'],
  discoveryQuestions: ['مشتری‌ها چطور با شما تماس می‌گیرند؟'],
} as unknown as Service;

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

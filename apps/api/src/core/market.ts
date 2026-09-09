import { normalizeText, type MarketSignalStrength } from '@baimar/shared';
import type { DataOrigin, DataQuality, KeywordSource, Prisma, Service } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getMarketSettings, type MarketSettings } from '../lib/settings';

/**
 * Market / search-intent intelligence.
 *
 * What this does: aggregates the signals we are legally allowed to hold — Baimar's own
 * advertising search terms, Baimar's own Search Console queries, imported keyword research
 * — into a demand picture per service and city.
 *
 * What this explicitly does NOT do: attribute a search to a person. There is no data source
 * in this platform that identifies who searched for anything, and the UI wording reflects
 * that ("demand signal detected", never "X searched for Y").
 *
 * When there is not enough data, the answer is INSUFFICIENT_DATA. A fabricated search
 * volume would be worse than no number at all.
 */

/** Keyword vocabulary used to attach a raw keyword to a Baimar service. */
export const SERVICE_KEYWORD_MAP: Record<string, string[]> = {
  WEBSITE_DESIGN: ['طراحی سایت', 'طراحی وب سایت', 'ساخت سایت', 'سایت شرکتی', 'website design', 'web design', 'ساخت وبسایت'],
  WEBSITE_REDESIGN: ['بازطراحی سایت', 'طراحی مجدد سایت', 'redesign', 'به روز رسانی سایت', 'نوسازی سایت'],
  RESPONSIVE_REDESIGN: ['سایت واکنش گرا', 'ریسپانسیو', 'responsive', 'نسخه موبایل سایت', 'mobile friendly'],
  ECOMMERCE: ['فروشگاه اینترنتی', 'فروشگاه آنلاین', 'سایت فروشگاهی', 'ecommerce', 'online store', 'woocommerce', 'درگاه پرداخت'],
  SEO: ['سئو', 'seo', 'بهینه سازی سایت', 'رتبه گوگل', 'search engine optimization', 'دیده شدن در گوگل'],
  BRANDING: ['برندینگ', 'هویت بصری', 'branding', 'brand identity', 'کاتالوگ'],
  LOGO_DESIGN: ['طراحی لوگو', 'لوگو', 'logo design', 'لوگوتایپ'],
  LANDING_PAGE: ['صفحه فرود', 'لندینگ پیج', 'landing page'],
  BOOKING_SYSTEM: ['نوبت دهی آنلاین', 'سیستم رزرو', 'رزرو آنلاین', 'booking system', 'appointment'],
  DIGITAL_MARKETING: ['تبلیغات آنلاین', 'دیجیتال مارکتینگ', 'گوگل ادز', 'google ads', 'digital marketing', 'تبلیغات اینترنتی'],
  WEBSITE_RESTRUCTURING: ['ساختار سایت', 'معماری اطلاعات', 'site structure'],
  MAINTENANCE: ['پشتیبانی سایت', 'نگهداری سایت', 'website maintenance', 'ssl', 'امنیت سایت'],
  AUTOMATION: ['اتوماسیون', 'automation', 'crm', 'یکپارچه سازی'],
};

/**
 * Best-effort classification of a keyword into a Baimar service.
 *
 * Vocabulary comes from three places, in this order of authority:
 *   1. the service's own `matchKeywords`, edited in Settings → Services — so adding a
 *      service to the catalogue never requires a code change here;
 *   2. SERVICE_KEYWORD_MAP above, the built-in defaults for the seeded services;
 *   3. the service's own display name.
 *
 * The longest match wins, because a longer phrase is the more specific claim:
 * "فروشگاه اینترنتی" should beat "سایت".
 */
export function classifyKeyword(keyword: string, services?: Service[]): string | null {
  const norm = normalizeText(keyword);
  if (!norm) return null;

  let best: { key: string; score: number } | null = null;
  const consider = (serviceKey: string, term: string, bonus = 0) => {
    const t = normalizeText(term);
    if (!t || !norm.includes(t)) return;
    const score = t.length + bonus;
    if (!best || score > best.score) best = { key: serviceKey, score };
  };

  // Administrator-configured vocabulary outranks the built-in defaults at equal length.
  for (const service of services ?? []) {
    for (const term of service.matchKeywords ?? []) consider(service.key, term, 1);
  }

  for (const [serviceKey, vocabulary] of Object.entries(SERVICE_KEYWORD_MAP)) {
    for (const term of vocabulary) consider(serviceKey, term);
  }

  if (best) return (best as { key: string }).key;

  // Fall back to matching the service's own configured name.
  for (const s of services ?? []) {
    if (norm.includes(normalizeText(s.nameFa)) || norm.includes(normalizeText(s.nameEn))) return s.key;
  }
  return null;
}

/**
 * How a search-volume figure came to exist.
 *
 * The distinction is the whole point of patch 17: the platform must never turn an
 * absent number into a confident one. "10,000 searches a month" is only ever printed
 * when a real source reported it.
 *
 *   REPORTED         a provider returned an absolute volume for this keyword
 *   IMPORTED         a human supplied it in a CSV; only as good as the sheet
 *   RELATIVE_SIGNAL  we can see relative demand (impressions, clicks) but no volume
 *   UNKNOWN          no volume data at all — displayed as "unknown", never as zero
 */
export type VolumeQuality = 'REPORTED' | 'IMPORTED' | 'RELATIVE_SIGNAL' | 'UNKNOWN';

export interface DemandAggregate {
  serviceKey: string | null;
  city: string | null;
  province: string | null;
  sources: KeywordSource[];
  sampleSize: number;
  totalClicks: number | null;
  totalImpressions: number | null;
  totalConversions: number | null;
  totalCostMicros: bigint | null;
  averageVolume: number | null;
  /** Provenance of `averageVolume`. Never omitted — see patch 17. */
  volumeQuality: VolumeQuality;
  score: number | null;
  strength: MarketSignalStrength;
  basis: string;
  /** Where the underlying observations came from. */
  origin: DataOrigin;
  /** The badge the UI prints next to this signal. */
  quality: DataQuality;
  sourceUrls: string[];
  /** Human-readable measurement window, e.g. "۱۰ مرداد تا ۹ شهریور ۱۴۰۵". */
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Provenance of a mixed set of sources.
 *
 * Rules, in priority order, because a signal must be labelled by its *weakest* honest
 * description rather than its most impressive one:
 *   - anything imported by hand is IMPORTED, however much of it there is;
 *   - Baimar's own Search Console/analytics is first-party FACT;
 *   - advertising search terms are an AGGREGATE over many people — never a person;
 *   - a third-party keyword provider is an aggregate estimate.
 */
export function provenanceOf(sources: KeywordSource[]): { origin: DataOrigin; quality: DataQuality } {
  if (sources.length === 0) return { origin: 'AGGREGATE_SEARCH_SIGNAL', quality: 'UNKNOWN' };
  if (sources.includes('MANUAL_IMPORT')) return { origin: 'MANUAL_ENTRY', quality: 'IMPORTED' };
  if (sources.includes('GOOGLE_ADS')) return { origin: 'ADVERTISING_CAMPAIGN', quality: 'AGGREGATE' };
  if (sources.includes('SEARCH_CONSOLE') || sources.includes('SITE_ANALYTICS')) {
    return { origin: 'FIRST_PARTY_BAIMAR', quality: 'FACT' };
  }
  return { origin: 'AGGREGATE_SEARCH_SIGNAL', quality: 'AGGREGATE' };
}

/** Persian date range, for the "measurement period" line every signal must carry. */
export function formatPeriodLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
  return `${fmt(start)} تا ${fmt(end)}`;
}

/**
 * Compute demand aggregates from everything we hold, and persist them as MarketSignal rows.
 * Returns the aggregates it wrote.
 */
export async function computeMarketSignals(
  opts: { city?: string | null; lookbackDays?: number; includeDemo?: boolean } = {},
): Promise<DemandAggregate[]> {
  const settings = await getMarketSettings();
  const lookbackDays = opts.lookbackDays ?? settings.lookbackDays;
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - lookbackDays * 24 * 3600 * 1000);

  const services = await prisma.service.findMany({ where: { isActive: true } });
  const byService = new Map<string, DemandBucket>();

  const bucketFor = (serviceKey: string, city: string | null): DemandBucket => {
    const id = `${serviceKey}::${city ?? ''}`;
    let bucket = byService.get(id);
    if (!bucket) {
      bucket = {
        serviceKey,
        city,
        province: null,
        sources: new Set<KeywordSource>(),
        sampleSize: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        costMicros: 0n,
        volumes: [],
        hasClickData: false,
        hasVolumeData: false,
        hasImportedVolume: false,
        sourceUrls: new Set<string>(),
      };
      byService.set(id, bucket);
    }
    return bucket;
  };

  // --- Keyword signals (research + Search Console) --------------------------
  const keywordSignals = await prisma.keywordSignal.findMany({
    where: {
      OR: [
        { date: { gte: periodStart } },
        { date: null, createdAt: { gte: periodStart } },
      ],
      ...(opts.city ? { city: opts.city } : {}),
      ...(opts.includeDemo ? {} : { isDemo: false }),
    },
    include: { keyword: true },
    take: 20000,
  });

  for (const signal of keywordSignals) {
    const serviceKey = classifyKeyword(signal.keyword.keyword, services);
    if (!serviceKey) continue;
    const bucket = bucketFor(serviceKey, signal.city ?? opts.city ?? null);
    bucket.sources.add(signal.source);
    bucket.sampleSize += 1;
    if (signal.province && !bucket.province) bucket.province = signal.province;
    if (typeof signal.clicks === 'number') {
      bucket.clicks += signal.clicks;
      bucket.hasClickData = true;
    }
    if (typeof signal.impressions === 'number') {
      bucket.impressions += signal.impressions;
      bucket.hasClickData = true;
    }
    if (typeof signal.conversions === 'number') bucket.conversions += signal.conversions;
    if (signal.costMicros) bucket.costMicros += signal.costMicros;
    if (typeof signal.searchVolume === 'number') {
      bucket.volumes.push(signal.searchVolume);
      bucket.hasVolumeData = true;
      if (signal.source === 'MANUAL_IMPORT') bucket.hasImportedVolume = true;
    }
    if (signal.sourceUrl) bucket.sourceUrls.add(signal.sourceUrl);
  }

  // --- Advertising search terms --------------------------------------------
  const searchTerms = await prisma.searchTerm.findMany({
    where: {
      OR: [
        { date: { gte: periodStart } },
        { date: null, createdAt: { gte: periodStart } },
      ],
      ...(opts.city ? { city: opts.city } : {}),
      ...(opts.includeDemo ? {} : { isDemo: false }),
    },
    take: 20000,
  });

  for (const term of searchTerms) {
    const serviceKey = term.serviceKey ?? classifyKeyword(term.term, services);
    if (!serviceKey) continue;
    const bucket = bucketFor(serviceKey, term.city ?? opts.city ?? null);
    bucket.sources.add(term.source);
    bucket.sampleSize += 1;
    if (term.province && !bucket.province) bucket.province = term.province;
    if (typeof term.clicks === 'number') {
      bucket.clicks += term.clicks;
      bucket.hasClickData = true;
    }
    if (typeof term.impressions === 'number') {
      bucket.impressions += term.impressions;
      bucket.hasClickData = true;
    }
    if (typeof term.conversions === 'number') bucket.conversions += term.conversions;
    if (term.costMicros) bucket.costMicros += term.costMicros;
    if (term.sourceUrl) bucket.sourceUrls.add(term.sourceUrl);
  }

  // --- Score and persist ----------------------------------------------------
  const aggregates: DemandAggregate[] = [];
  const serviceIdByKey = new Map(services.map((s) => [s.key, s.id]));

  for (const bucket of byService.values()) {
    const aggregate = scoreBucket(bucket, settings, periodStart, periodEnd);
    aggregates.push(aggregate);

    await prisma.marketSignal.upsert({
      where: {
        serviceKey_city_periodStart_periodEnd: {
          serviceKey: aggregate.serviceKey ?? '',
          city: aggregate.city ?? '',
          periodStart,
          periodEnd,
        },
      },
      create: {
        serviceId: aggregate.serviceKey ? serviceIdByKey.get(aggregate.serviceKey) ?? null : null,
        serviceKey: aggregate.serviceKey,
        city: aggregate.city,
        province: aggregate.province,
        strength: aggregate.strength,
        score: aggregate.score,
        basis: aggregate.basis,
        confidence: aggregate.strength === 'INSUFFICIENT_DATA' ? 'UNKNOWN' : 'CALCULATED',
        origin: aggregate.origin,
        quality: aggregate.quality,
        sourceUrls: aggregate.sourceUrls,
        periodLabel: aggregate.periodLabel,
        sources: aggregate.sources,
        sampleSize: aggregate.sampleSize,
        totalClicks: aggregate.totalClicks,
        totalImpressions: aggregate.totalImpressions,
        totalConversions: aggregate.totalConversions,
        totalCostMicros: aggregate.totalCostMicros,
        averageVolume: aggregate.averageVolume,
        periodStart,
        periodEnd,
        isDemo: opts.includeDemo ?? false,
      },
      update: {
        strength: aggregate.strength,
        score: aggregate.score,
        basis: aggregate.basis,
        confidence: aggregate.strength === 'INSUFFICIENT_DATA' ? 'UNKNOWN' : 'CALCULATED',
        origin: aggregate.origin,
        quality: aggregate.quality,
        sourceUrls: aggregate.sourceUrls,
        periodLabel: aggregate.periodLabel,
        sources: aggregate.sources,
        sampleSize: aggregate.sampleSize,
        totalClicks: aggregate.totalClicks,
        totalImpressions: aggregate.totalImpressions,
        totalConversions: aggregate.totalConversions,
        totalCostMicros: aggregate.totalCostMicros,
        averageVolume: aggregate.averageVolume,
        computedAt: new Date(),
      },
    });
  }

  return aggregates.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

interface DemandBucket {
  serviceKey: string;
  city: string | null;
  province: string | null;
  sources: Set<KeywordSource>;
  sampleSize: number;
  clicks: number;
  impressions: number;
  conversions: number;
  costMicros: bigint;
  volumes: number[];
  hasClickData: boolean;
  hasVolumeData: boolean;
  /** Whether any volume figure came from a hand-uploaded sheet. */
  hasImportedVolume: boolean;
  sourceUrls: Set<string>;
}

function scoreBucket(
  bucket: DemandBucket,
  settings: MarketSettings,
  periodStart: Date,
  periodEnd: Date,
): DemandAggregate {
  const sources = Array.from(bucket.sources);
  const averageVolume = bucket.volumes.length
    ? bucket.volumes.reduce((a, b) => a + b, 0) / bucket.volumes.length
    : null;

  const { origin, quality } = provenanceOf(sources);
  const periodLabel = formatPeriodLabel(periodStart, periodEnd);
  const sourceUrls = Array.from(bucket.sourceUrls).slice(0, 20);

  // Patch 17. An absolute search volume is only ever claimed when a source reported one.
  // With clicks and impressions but no volume we can say demand is relatively strong —
  // and we say exactly that, rather than inventing a number to fill the column.
  const volumeQuality: VolumeQuality = bucket.hasVolumeData
    ? bucket.hasImportedVolume
      ? 'IMPORTED'
      : 'REPORTED'
    : bucket.hasClickData
      ? 'RELATIVE_SIGNAL'
      : 'UNKNOWN';

  // Not enough observations to say anything. Say exactly that.
  if (bucket.sampleSize < settings.minSampleSize) {
    return {
      serviceKey: bucket.serviceKey,
      city: bucket.city,
      province: bucket.province,
      sources,
      sampleSize: bucket.sampleSize,
      totalClicks: bucket.hasClickData ? bucket.clicks : null,
      totalImpressions: bucket.hasClickData ? bucket.impressions : null,
      totalConversions: bucket.conversions || null,
      totalCostMicros: bucket.costMicros > 0n ? bucket.costMicros : null,
      averageVolume,
      volumeQuality,
      score: null,
      strength: 'INSUFFICIENT_DATA',
      basis: `فقط ${bucket.sampleSize} مشاهده در بازه — کمتر از حداقل ${settings.minSampleSize} مورد نیاز`,
      origin,
      // Too little data to characterise: the label says unknown rather than implying
      // that a thin sample is a measured fact.
      quality: 'UNKNOWN',
      sourceUrls,
      periodLabel,
      periodStart,
      periodEnd,
    };
  }

  // Log-scaled components keep one very large campaign from dominating the picture.
  const impressionScore = bucket.hasClickData ? Math.min(40, Math.log10(bucket.impressions + 1) * 13) : 0;
  const clickScore = bucket.hasClickData ? Math.min(30, Math.log10(bucket.clicks + 1) * 15) : 0;
  const volumeScore = averageVolume !== null ? Math.min(35, Math.log10(averageVolume + 1) * 11) : 0;
  const conversionScore = Math.min(20, bucket.conversions * 4);
  const breadthScore = Math.min(10, bucket.sampleSize * 0.5);

  const raw = impressionScore + clickScore + volumeScore + conversionScore + breadthScore;
  const score = Math.round(Math.min(100, raw));

  const t = settings.thresholds;
  const strength: MarketSignalStrength =
    score >= t.veryHigh ? 'VERY_HIGH' : score >= t.high ? 'HIGH' : score >= t.medium ? 'MEDIUM' : score >= t.low ? 'LOW' : 'INSUFFICIENT_DATA';

  const basisParts: string[] = [];
  if (bucket.hasClickData) {
    basisParts.push(`${bucket.impressions.toLocaleString('fa-IR')} نمایش و ${bucket.clicks.toLocaleString('fa-IR')} کلیک`);
  }
  if (averageVolume !== null) {
    const label = volumeQuality === 'IMPORTED' ? 'حجم جست‌وجوی واردشده (CSV)' : 'میانگین حجم جست‌وجوی گزارش‌شده';
    basisParts.push(`${label}: ${Math.round(averageVolume).toLocaleString('fa-IR')}`);
  } else if (volumeQuality === 'RELATIVE_SIGNAL') {
    basisParts.push('حجم جست‌وجوی مطلق در دسترس نیست — فقط سیگنال نسبی تقاضا');
  }
  if (bucket.conversions > 0) basisParts.push(`${bucket.conversions.toFixed(1)} تبدیل`);
  basisParts.push(`${bucket.sampleSize} مشاهده از ${sources.map(sourceLabelFa).join('، ')}`);

  return {
    serviceKey: bucket.serviceKey,
    city: bucket.city,
    province: bucket.province,
    sources,
    sampleSize: bucket.sampleSize,
    totalClicks: bucket.hasClickData ? bucket.clicks : null,
    totalImpressions: bucket.hasClickData ? bucket.impressions : null,
    totalConversions: bucket.conversions || null,
    totalCostMicros: bucket.costMicros > 0n ? bucket.costMicros : null,
    averageVolume,
    volumeQuality,
    score,
    strength,
    basis: basisParts.join(' • '),
    origin,
    quality,
    sourceUrls,
    periodLabel,
    periodStart,
    periodEnd,
  };
}

export function sourceLabelFa(source: KeywordSource): string {
  return {
    GOOGLE_ADS: 'گوگل ادز',
    SEARCH_CONSOLE: 'سرچ کنسول بایمر',
    MANUAL_IMPORT: 'ورود دستی',
    SITE_ANALYTICS: 'آنالیتیکس بایمر',
    PROVIDER: 'ارائه‌دهنده داده',
  }[source];
}

/**
 * Build the market-boost lookup consumed by the opportunity engine.
 * Only strong, well-evidenced signals produce a boost.
 */
export async function buildMarketBoost(city: string | null): Promise<(serviceKey: string) => { points: number; reasonFa: string } | null> {
  const where: Prisma.MarketSignalWhereInput = {
    strength: { in: ['HIGH', 'VERY_HIGH'] },
    isDemo: false,
    ...(city ? { OR: [{ city }, { city: null }] } : {}),
  };
  const signals = await prisma.marketSignal.findMany({ where, orderBy: { computedAt: 'desc' }, take: 200 });

  const byService = new Map<string, { points: number; reasonFa: string }>();
  for (const s of signals) {
    if (!s.serviceKey || byService.has(s.serviceKey)) continue;
    const points = s.strength === 'VERY_HIGH' ? 20 : 12;
    byService.set(s.serviceKey, {
      points,
      reasonFa: `تقاضای بازار برای این خدمت${s.city ? ` در ${s.city}` : ''} ${s.strength === 'VERY_HIGH' ? 'بسیار بالا' : 'بالا'} است (${s.basis})`,
    });
  }

  return (serviceKey: string) => byService.get(serviceKey) ?? null;
}

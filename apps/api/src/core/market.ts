import { normalizeText, type MarketSignalStrength } from '@baimar/shared';
import type { KeywordSource, Prisma, Service } from '@prisma/client';
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

/** Best-effort classification of a keyword into a Baimar service. */
export function classifyKeyword(keyword: string, services?: Service[]): string | null {
  const norm = normalizeText(keyword);
  if (!norm) return null;

  let best: { key: string; score: number } | null = null;
  for (const [serviceKey, vocabulary] of Object.entries(SERVICE_KEYWORD_MAP)) {
    for (const term of vocabulary) {
      const t = normalizeText(term);
      if (!t) continue;
      if (norm.includes(t)) {
        // Longer vocabulary matches are more specific and win.
        const score = t.length;
        if (!best || score > best.score) best = { key: serviceKey, score };
      }
    }
  }

  if (best) return best.key;

  // Fall back to matching the service's own configured name.
  if (services?.length) {
    for (const s of services) {
      if (norm.includes(normalizeText(s.nameFa)) || norm.includes(normalizeText(s.nameEn))) return s.key;
    }
  }
  return null;
}

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
  score: number | null;
  strength: MarketSignalStrength;
  basis: string;
  periodStart: Date;
  periodEnd: Date;
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
    }
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
      score: null,
      strength: 'INSUFFICIENT_DATA',
      basis: `فقط ${bucket.sampleSize} مشاهده در بازه — کمتر از حداقل ${settings.minSampleSize} مورد نیاز`,
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
  if (averageVolume !== null) basisParts.push(`میانگین حجم جست‌وجوی گزارش‌شده ${Math.round(averageVolume).toLocaleString('fa-IR')}`);
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
    score,
    strength,
    basis: basisParts.join(' • '),
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

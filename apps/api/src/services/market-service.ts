import { normalizeText } from '@baimar/shared';
import type { KeywordSource, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { activeKeywordProviders, callProvider } from '../providers/registry';
import type { KeywordObservation, SearchTermObservation } from '../providers/types';
import { classifyKeyword } from '../core/market';

/**
 * Keyword and search-term ingestion.
 *
 * Everything written here is aggregate or first-party data. There is no code path in this
 * platform that stores or requests an individual person's search activity, and the source
 * of every row is recorded so the UI can label it (advertising vs. first-party vs. imported).
 */

export interface SyncResult {
  providerKey: string;
  keywordObservations: number;
  searchTerms: number;
  error?: string;
}

export async function syncKeywordProviders(opts: { city?: string; keywords?: string[]; from?: Date; to?: Date } = {}): Promise<SyncResult[]> {
  const providers = await activeKeywordProviders();
  const results: SyncResult[] = [];

  for (const provider of providers) {
    const result: SyncResult = { providerKey: provider.descriptor.key, keywordObservations: 0, searchTerms: 0 };
    try {
      if (provider.fetchKeywordData) {
        const observations = await callProvider(provider, () =>
          provider.fetchKeywordData!({ city: opts.city, keywords: opts.keywords, from: opts.from, to: opts.to, limit: 1000 }),
        );
        result.keywordObservations = await storeKeywordObservations(observations);
      }
      if (provider.fetchSearchTerms) {
        const terms = await callProvider(provider, () =>
          provider.fetchSearchTerms!({ city: opts.city, from: opts.from, to: opts.to, limit: 2000 }),
        );
        result.searchTerms = await storeSearchTerms(terms);
      }
    } catch (err) {
      // One provider failing must not stop the others.
      result.error = err instanceof Error ? err.message : String(err);
    }
    results.push(result);
  }

  return results;
}

export async function storeKeywordObservations(observations: KeywordObservation[], opts: { isDemo?: boolean } = {}): Promise<number> {
  if (!observations.length) return 0;
  const services = await prisma.service.findMany({ where: { isActive: true } });
  let stored = 0;

  for (const obs of observations) {
    const normalized = normalizeText(obs.keyword);
    if (!normalized) continue;

    const keyword = await prisma.keyword.upsert({
      where: { normalizedKeyword_language: { normalizedKeyword: normalized, language: obs.language ?? 'fa' } },
      create: { keyword: obs.keyword, normalizedKeyword: normalized, language: obs.language ?? 'fa', isDemo: opts.isDemo ?? false },
      update: {},
    });

    await prisma.keywordSignal.create({
      data: {
        keywordId: keyword.id,
        source: obs.source as KeywordSource,
        sourceUrl: obs.sourceUrl ?? null,
        origin: obs.origin,
        city: obs.city ?? null,
        province: obs.province ?? null,
        country: obs.country ?? 'IR',
        searchVolume: obs.searchVolume ?? null,
        competition: obs.competition ?? null,
        competitionIndex: obs.competitionIndex ?? null,
        trend: obs.trend ?? null,
        clicks: obs.clicks ?? null,
        impressions: obs.impressions ?? null,
        conversions: obs.conversions ?? null,
        costMicros: obs.costMicros !== undefined ? BigInt(Math.round(obs.costMicros)) : null,
        ctr: obs.ctr ?? null,
        averagePosition: obs.averagePosition ?? null,
        date: obs.date ?? null,
        periodStart: obs.periodStart ?? null,
        periodEnd: obs.periodEnd ?? null,
        isDemo: opts.isDemo ?? false,
      },
    });
    stored++;

    if (obs.city || obs.province) {
      await prisma.keywordLocation
        .upsert({
          where: {
            keywordId_city_province_country: {
              keywordId: keyword.id,
              city: obs.city ?? '',
              province: obs.province ?? '',
              country: obs.country ?? 'IR',
            },
          },
          create: { keywordId: keyword.id, city: obs.city ?? null, province: obs.province ?? null, country: obs.country ?? 'IR' },
          update: {},
        })
        .catch(() => undefined);
    }

    const serviceKey = classifyKeyword(obs.keyword, services);
    const service = serviceKey ? services.find((s) => s.key === serviceKey) : null;
    if (service) {
      await prisma.keywordService
        .upsert({
          where: { keywordId_serviceId: { keywordId: keyword.id, serviceId: service.id } },
          create: { keywordId: keyword.id, serviceId: service.id, serviceKey: service.key },
          update: {},
        })
        .catch(() => undefined);
    }

    if (obs.trend) {
      await prisma.keywordTrend
        .upsert({
          where: {
            keywordId_period_source: {
              keywordId: keyword.id,
              period: (obs.date ?? obs.periodEnd ?? new Date()).toISOString().slice(0, 7),
              source: obs.source as KeywordSource,
            },
          },
          create: {
            keywordId: keyword.id,
            period: (obs.date ?? obs.periodEnd ?? new Date()).toISOString().slice(0, 7),
            value: obs.searchVolume ?? obs.impressions ?? 0,
            direction: obs.trend,
            source: obs.source as KeywordSource,
          },
          update: { value: obs.searchVolume ?? obs.impressions ?? 0, direction: obs.trend },
        })
        .catch(() => undefined);
    }
  }

  return stored;
}

export async function storeSearchTerms(terms: SearchTermObservation[], opts: { isDemo?: boolean } = {}): Promise<number> {
  if (!terms.length) return 0;
  const services = await prisma.service.findMany({ where: { isActive: true } });

  const rows: Prisma.SearchTermCreateManyInput[] = terms
    .filter((t) => t.term?.trim())
    .map((t) => ({
      term: t.term,
      normalizedTerm: normalizeText(t.term),
      source: t.source as KeywordSource,
      origin: t.origin,
      campaignName: t.campaignName ?? null,
      adGroupName: t.adGroupName ?? null,
      matchType: t.matchType ?? null,
      city: t.city ?? null,
      province: t.province ?? null,
      country: t.country ?? 'IR',
      clicks: t.clicks ?? null,
      impressions: t.impressions ?? null,
      conversions: t.conversions ?? null,
      costMicros: t.costMicros !== undefined ? BigInt(Math.round(t.costMicros)) : null,
      ctr: t.ctr ?? null,
      averagePosition: t.averagePosition ?? null,
      averageCpcMicros: t.averageCpcMicros !== undefined ? BigInt(Math.round(t.averageCpcMicros)) : null,
      date: t.date ?? null,
      periodStart: t.periodStart ?? null,
      periodEnd: t.periodEnd ?? null,
      serviceKey: classifyKeyword(t.term, services),
      isDemo: opts.isDemo ?? false,
    }));

  if (!rows.length) return 0;
  const result = await prisma.searchTerm.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

/**
 * Leads that match a demand signal.
 *
 * This is the bridge the product is built around: a strong market signal for, say,
 * e-commerce in Arak is turned into "these specific businesses in Arak have no online
 * store, are commercially attractive, and are worth calling about it".
 */
export async function leadsForDemand(opts: {
  serviceKey: string;
  city?: string | null;
  limit?: number;
  includeDemo?: boolean;
}): Promise<Array<{ leadId: string; businessName: string; city: string | null; opportunityScore: number; level: string; reasons: string[]; leadScore: number | null; businessValueTier: string }>> {
  const opportunities = await prisma.opportunity.findMany({
    where: {
      serviceKey: opts.serviceKey,
      lead: {
        isArchived: false,
        ...(opts.includeDemo ? {} : { isDemo: false }),
        ...(opts.city ? { city: opts.city } : {}),
        contactStatus: { notIn: ['WON', 'LOST', 'NOT_INTERESTED'] },
      },
    },
    include: { lead: true },
    orderBy: [{ score: 'desc' }],
    take: opts.limit ?? 50,
  });

  return opportunities.map((o) => ({
    leadId: o.leadId,
    businessName: o.lead.businessName,
    city: o.lead.city,
    opportunityScore: o.score,
    level: o.level,
    reasons: o.reasons,
    leadScore: o.lead.leadScore,
    businessValueTier: o.lead.businessValueTier,
  }));
}

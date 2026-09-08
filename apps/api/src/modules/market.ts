import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { jsonSafe, prisma } from '../lib/prisma';
import { getMarketSettings } from '../lib/settings';
import { computeMarketSignals, sourceLabelFa } from '../core/market';
import { activeKeywordProviders } from '../providers/registry';
import { enqueue } from '../queue/queues';
import { exportMarketCsv } from '../services/export-service';
import { importKeywordsCsv } from '../services/import-service';
import { leadsForDemand, syncKeywordProviders } from '../services/market-service';

/**
 * Market intelligence endpoints.
 *
 * Everything returned here is aggregate demand data with its source attached. The API
 * deliberately exposes `hasData: false` and `INSUFFICIENT_DATA` rather than zeros, so the
 * dashboard can say "no data yet" instead of drawing an empty chart that looks like
 * "no demand".
 */

export default async function marketRoutes(app: FastifyInstance) {
  /* ----------------------------- Overview -------------------------------- */
  app.get('/overview', { onRequest: [app.requirePermission('market:read')] }, async (req) => {
    const query = z.object({ city: z.string().optional(), includeDemo: z.coerce.boolean().default(false) }).parse(req.query);

    const signals = await prisma.marketSignal.findMany({
      where: { ...(query.city ? { city: query.city } : {}), ...(query.includeDemo ? {} : { isDemo: false }) },
      // Signals with an actual score come first: Postgres would otherwise sort the
      // NULL-scored "insufficient data" rows above the ones worth reading.
      orderBy: [{ score: { sort: 'desc', nulls: 'last' } }],
      take: 100,
    });

    const services = await prisma.service.findMany({ select: { key: true, nameFa: true } });
    const serviceName = new Map(services.map((s) => [s.key, s.nameFa]));

    const [keywordCount, searchTermCount, lastImport] = await Promise.all([
      prisma.keyword.count({ where: query.includeDemo ? {} : { isDemo: false } }),
      prisma.searchTerm.count({ where: query.includeDemo ? {} : { isDemo: false } }),
      prisma.importBatch.findFirst({ where: { kind: { in: ['KEYWORDS', 'SEARCH_TERMS'] } }, orderBy: { createdAt: 'desc' } }),
    ]);

    const withData = signals.filter((s) => s.strength !== 'INSUFFICIENT_DATA');
    const topService = withData[0] ?? null;

    const cityCounts = new Map<string, number>();
    for (const s of withData) {
      if (!s.city) continue;
      cityCounts.set(s.city, (cityCounts.get(s.city) ?? 0) + (s.score ?? 0));
    }
    const topCity = Array.from(cityCounts.entries()).sort((a, b) => b[1] - a[1])[0] ?? null;

    const topKeyword = await prisma.keywordSignal.findFirst({
      where: {
        OR: [{ impressions: { not: null } }, { searchVolume: { not: null } }],
        ...(query.includeDemo ? {} : { isDemo: false }),
      },
      orderBy: [{ impressions: 'desc' }, { searchVolume: 'desc' }],
      include: { keyword: true },
    });

    return jsonSafe({
      hasData: withData.length > 0,
      kpis: {
        topService: topService
          ? { key: topService.serviceKey, name: serviceName.get(topService.serviceKey ?? '') ?? topService.serviceKey, strength: topService.strength }
          : null,
        topCity: topCity ? { city: topCity[0], strength: 'CALCULATED' } : null,
        topKeyword: topKeyword
          ? {
              keyword: topKeyword.keyword.keyword,
              metricLabel:
                topKeyword.impressions !== null
                  ? `${topKeyword.impressions.toLocaleString('fa-IR')} نمایش`
                  : `حجم گزارش‌شده ${topKeyword.searchVolume?.toLocaleString('fa-IR')}`,
            }
          : null,
        keywordCount,
        searchTermCount,
        lastImportAt: lastImport?.createdAt ?? null,
      },
      serviceDemand: signals.map((s) => ({
        id: s.id,
        serviceKey: s.serviceKey,
        serviceName: serviceName.get(s.serviceKey ?? '') ?? s.serviceKey,
        city: s.city,
        province: s.province,
        strength: s.strength,
        score: s.score,
        basis: s.basis,
        confidence: s.confidence,
        sources: s.sources,
        sourceLabels: s.sources.map(sourceLabelFa),
        sampleSize: s.sampleSize,
        totalClicks: s.totalClicks,
        totalImpressions: s.totalImpressions,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
      })),
      emptyStateHint:
        withData.length > 0
          ? null
          : 'هنوز داده تقاضایی ثبت نشده است. یک فایل کلیدواژه وارد کنید یا اتصال گوگل ادز / سرچ کنسول را در تنظیمات فعال کنید.',
    });
  });

  /* ----------------------------- Keywords -------------------------------- */
  app.get('/keywords', { onRequest: [app.requirePermission('market:read')] }, async (req) => {
    const query = z
      .object({
        q: z.string().optional(),
        city: z.string().optional(),
        serviceKey: z.string().optional(),
        source: z.string().optional(),
        includeDemo: z.coerce.boolean().default(false),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(200).default(50),
      })
      .parse(req.query);

    const where: Prisma.KeywordSignalWhereInput = query.includeDemo ? {} : { isDemo: false };
    if (query.city) where.city = query.city;
    if (query.source) where.source = query.source as Prisma.KeywordSignalWhereInput['source'];
    const keywordFilter: Prisma.KeywordWhereInput = {};
    if (query.q) keywordFilter.keyword = { contains: query.q, mode: 'insensitive' };
    if (query.serviceKey) keywordFilter.services = { some: { serviceKey: query.serviceKey } };
    if (Object.keys(keywordFilter).length) where.keyword = keywordFilter;

    const [total, rows] = await Promise.all([
      prisma.keywordSignal.count({ where }),
      prisma.keywordSignal.findMany({
        where,
        include: { keyword: { include: { services: true } } },
        orderBy: [{ impressions: 'desc' }, { searchVolume: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return jsonSafe({
      items: rows.map((r) => ({
        id: r.id,
        keyword: r.keyword.keyword,
        normalizedKeyword: r.keyword.normalizedKeyword,
        language: r.keyword.language,
        city: r.city,
        province: r.province,
        serviceKey: r.keyword.services[0]?.serviceKey ?? null,
        source: r.source,
        sourceLabel: sourceLabelFa(r.source),
        sourceUrl: r.sourceUrl,
        origin: r.origin,
        searchVolume: r.searchVolume,
        competition: r.competition,
        trend: r.trend,
        clicks: r.clicks,
        impressions: r.impressions,
        conversions: r.conversions,
        costMicros: r.costMicros,
        ctr: r.ctr,
        averagePosition: r.averagePosition,
        date: r.date,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    });
  });

  app.get('/search-terms', { onRequest: [app.requirePermission('market:read')] }, async (req) => {
    const query = z
      .object({
        q: z.string().optional(),
        serviceKey: z.string().optional(),
        includeDemo: z.coerce.boolean().default(false),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(200).default(50),
      })
      .parse(req.query);

    const where: Prisma.SearchTermWhereInput = query.includeDemo ? {} : { isDemo: false };
    if (query.q) where.term = { contains: query.q, mode: 'insensitive' };
    if (query.serviceKey) where.serviceKey = query.serviceKey;

    const [total, items] = await Promise.all([
      prisma.searchTerm.count({ where }),
      prisma.searchTerm.findMany({
        where,
        orderBy: [{ impressions: 'desc' }, { clicks: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return jsonSafe({ items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) });
  });

  /* -------------------- Market → lead opportunity bridge ------------------ */
  app.get('/opportunities', { onRequest: [app.requirePermission('market:read')] }, async (req) => {
    const query = z
      .object({
        serviceKey: z.string(),
        city: z.string().optional(),
        limit: z.coerce.number().min(1).max(200).default(50),
        includeDemo: z.coerce.boolean().optional(),
      })
      .parse(req.query);

    const [leads, signal, service] = await Promise.all([
      leadsForDemand({ serviceKey: query.serviceKey, city: query.city ?? null, limit: query.limit, includeDemo: query.includeDemo }),
      prisma.marketSignal.findFirst({
        where: {
          serviceKey: query.serviceKey,
          ...(query.city ? { city: query.city } : {}),
          ...(query.includeDemo ? {} : { isDemo: false }),
        },
        orderBy: { computedAt: 'desc' },
      }),
      prisma.service.findUnique({ where: { key: query.serviceKey } }),
    ]);

    return {
      service: service ? { key: service.key, nameFa: service.nameFa } : null,
      marketSignal: signal
        ? { strength: signal.strength, basis: signal.basis, score: signal.score, sources: signal.sources }
        : null,
      items: leads,
      note: signal
        ? null
        : 'برای این خدمت هنوز سیگنال تقاضایی ثبت نشده است؛ فهرست زیر فقط بر پایه تحلیل خود کسب‌وکارها است.',
    };
  });

  /* ------------------------------ Actions --------------------------------- */
  app.post('/recompute', { onRequest: [app.requirePermission('market:import')] }, async (req) => {
    const body = z
      .object({ city: z.string().optional(), lookbackDays: z.number().min(1).max(730).optional(), syncProviders: z.boolean().default(false), async: z.boolean().default(true) })
      .parse(req.body ?? {});

    if (body.async) {
      const jobId = await enqueue('market_analysis', { city: body.city, lookbackDays: body.lookbackDays, syncProviders: body.syncProviders });
      if (jobId) return { queued: true, jobId };
    }

    const synced = body.syncProviders ? await syncKeywordProviders({ city: body.city }) : null;
    const aggregates = await computeMarketSignals({ city: body.city, lookbackDays: body.lookbackDays });
    return { queued: false, synced, signals: aggregates.length };
  });

  app.post('/import', { onRequest: [app.requirePermission('market:import')] }, async (req) => {
    const body = z
      .object({
        content: z.string().min(1),
        filename: z.string().optional(),
        source: z.enum(['MANUAL_IMPORT', 'GOOGLE_ADS', 'SEARCH_CONSOLE', 'PROVIDER']).default('MANUAL_IMPORT'),
        asSearchTerms: z.boolean().default(false),
        city: z.string().optional(),
      })
      .parse(req.body);

    const result = await importKeywordsCsv(body.content, {
      filename: body.filename,
      createdById: req.user!.id,
      source: body.source,
      asSearchTerms: body.asSearchTerms,
      city: body.city,
    });

    // Newly imported data changes the demand picture straight away.
    await enqueue('market_analysis', { city: body.city });
    return result;
  });

  app.get('/export', { onRequest: [app.requirePermission('market:read')] }, async (req, reply) => {
    const csv = await exportMarketCsv();
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="baimar-market-${new Date().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });

  /** What the market module can currently see, for the empty-state and settings screens. */
  app.get('/sources', { onRequest: [app.requirePermission('market:read')] }, async () => {
    const providers = await prisma.provider.findMany({ where: { kind: 'KEYWORD_INSIGHT' }, orderBy: { priority: 'desc' } });
    const active = await activeKeywordProviders();
    const settings = await getMarketSettings();

    return {
      settings,
      providers: providers.map((p) => ({
        key: p.key,
        displayName: p.displayName,
        description: p.description,
        enabled: p.enabled,
        state: p.state,
        usable: active.some((a) => a.descriptor.key === p.key),
        lastError: p.lastError,
        lastUsedAt: p.lastUsedAt,
      })),
      privacyNote:
        'این بخش فقط داده تجمیعی و داده حساب‌های خود بایمر را نمایش می‌دهد. هیچ اطلاعاتی درباره جست‌وجوی افراد مشخص جمع‌آوری یا ذخیره نمی‌شود.',
    };
  });
}

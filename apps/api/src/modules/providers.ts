import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PROVIDER_KINDS } from '@baimar/shared';
import { recordAudit } from '../lib/audit-log';
import { notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { allProviders, findProvider, syncProviders } from '../providers/registry';
import { queueHealth } from '../queue/queues';

/**
 * Integration management.
 *
 * The response deliberately never contains a credential — only which settings are
 * required, which are missing, and the resulting state. That is what the "Not configured"
 * panel needs, and it is all the browser is ever allowed to know.
 */

export default async function providerRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.requirePermission('provider:read')] }, async (req) => {
    const query = z.object({ kind: z.enum(PROVIDER_KINDS).optional() }).parse(req.query);

    await syncProviders().catch(() => undefined);

    const rows = await prisma.provider.findMany({
      where: query.kind ? { kind: query.kind } : undefined,
      orderBy: [{ kind: 'asc' }, { priority: 'desc' }],
    });

    const items = rows.map((row) => {
      const provider = findProvider(row.key);
      const configured = provider?.isConfigured() ?? false;
      const missing = provider?.missingConfig() ?? [];
      const descriptor = provider?.descriptor;

      return {
        key: row.key,
        kind: row.kind,
        displayName: row.displayName,
        description: row.description,
        enabled: row.enabled,
        state: !row.enabled ? 'DISABLED' : row.state === 'ERROR' ? 'ERROR' : configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
        requiredConfig: descriptor?.requiredConfig ?? [],
        missingConfig: missing,
        cost: descriptor?.cost ?? 'FREE',
        docsUrl: descriptor?.docsUrl ?? null,
        attribution: descriptor?.attribution ?? null,
        priority: row.priority,
        rateLimits: {
          perMinute: row.rateLimitPerMinute,
          perHour: row.rateLimitPerHour,
          perDay: row.rateLimitPerDay,
        },
        lastError: row.lastError,
        lastErrorAt: row.lastErrorAt,
        lastUsedAt: row.lastUsedAt,
      };
    });

    return { items };
  });

  app.patch('/:key', { onRequest: [app.requirePermission('provider:write')] }, async (req) => {
    const { key } = z.object({ key: z.string() }).parse(req.params);
    const body = z
      .object({
        enabled: z.boolean().optional(),
        priority: z.number().int().min(0).max(1000).optional(),
        rateLimitPerMinute: z.number().int().min(0).nullable().optional(),
        rateLimitPerHour: z.number().int().min(0).nullable().optional(),
        rateLimitPerDay: z.number().int().min(0).nullable().optional(),
      })
      .parse(req.body);

    const existing = await prisma.provider.findUnique({ where: { key } });
    if (!existing) throw notFound('Provider');

    const provider = findProvider(key);
    const configured = provider?.isConfigured() ?? false;
    const enabled = body.enabled ?? existing.enabled;

    const row = await prisma.provider.update({
      where: { key },
      data: {
        ...body,
        state: !enabled ? 'DISABLED' : configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
        // Toggling a provider clears a stale error so the next call is judged fresh.
        lastError: body.enabled !== undefined ? null : existing.lastError,
      },
    });

    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'provider.updated',
      entityType: 'Provider',
      entityId: key,
      before: { enabled: existing.enabled, priority: existing.priority },
      after: { enabled: row.enabled, priority: row.priority },
      ip: req.ip,
    });

    return { provider: { key: row.key, enabled: row.enabled, state: row.state, priority: row.priority } };
  });

  app.post('/:key/test', { onRequest: [app.requirePermission('provider:write')] }, async (req) => {
    const { key } = z.object({ key: z.string() }).parse(req.params);
    const provider = findProvider(key);
    if (!provider) throw notFound('Provider');

    if (!provider.healthCheck) {
      return { ok: provider.isConfigured(), message: provider.isConfigured() ? 'Configured (no health check available)' : 'Not configured' };
    }

    const started = Date.now();
    const result = await provider.healthCheck();

    await prisma.provider
      .update({
        where: { key },
        data: result.ok
          ? { state: 'CONFIGURED', lastError: null, lastErrorAt: null }
          : { state: 'ERROR', lastError: result.message.slice(0, 1000), lastErrorAt: new Date() },
      })
      .catch(() => undefined);

    return { ...result, durationMs: Date.now() - started };
  });

  /* --------------------------- Usage & cost ------------------------------- */
  app.get('/usage', { onRequest: [app.requirePermission('provider:read')] }, async () => {
    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

    const [todayRows, monthRows, providers] = await Promise.all([
      prisma.providerUsage.findMany({ where: { day: startOfDay } }),
      prisma.providerUsage.groupBy({
        by: ['providerKey', 'kind'],
        where: { day: { gte: startOfMonth } },
        _sum: { requests: true, failures: true, totalTokens: true, estimatedCostUsd: true, bytesFetched: true },
      }),
      prisma.provider.findMany({ select: { key: true, displayName: true, kind: true, lastUsedAt: true } }),
    ]);

    const nameOf = new Map(providers.map((p) => [p.key, p.displayName]));
    const lastUsed = new Map(providers.map((p) => [p.key, p.lastUsedAt]));

    const items = monthRows.map((row) => {
      const todayRow = todayRows.find((t) => t.providerKey === row.providerKey);
      return {
        providerKey: row.providerKey,
        displayName: nameOf.get(row.providerKey) ?? row.providerKey,
        kind: row.kind,
        requestsToday: todayRow?.requests ?? 0,
        failuresToday: todayRow?.failures ?? 0,
        requestsThisMonth: row._sum.requests ?? 0,
        failuresThisMonth: row._sum.failures ?? 0,
        tokensThisMonth: row._sum.totalTokens ?? 0,
        estimatedCostThisMonthUsd: Math.round((row._sum.estimatedCostUsd ?? 0) * 10000) / 10000,
        bytesFetchedThisMonth: Number(row._sum.bytesFetched ?? 0n),
        lastUsedAt: lastUsed.get(row.providerKey) ?? null,
      };
    });

    const aiSpend = items.filter((i) => i.kind === 'AI').reduce((s, i) => s + i.estimatedCostThisMonthUsd, 0);

    return {
      items: items.sort((a, b) => b.requestsThisMonth - a.requestsThisMonth),
      totals: {
        requestsToday: items.reduce((s, i) => s + i.requestsToday, 0),
        requestsThisMonth: items.reduce((s, i) => s + i.requestsThisMonth, 0),
        failuresThisMonth: items.reduce((s, i) => s + i.failuresThisMonth, 0),
        estimatedAiCostThisMonthUsd: Math.round(aiSpend * 10000) / 10000,
      },
      costNote:
        'هزینه‌ها تخمینی است و بر پایه جدول قیمت قابل ویرایش در تنظیمات محاسبه می‌شود. مدل‌هایی که قیمت آن‌ها تعریف نشده باشد در جمع هزینه لحاظ نمی‌شوند.',
    };
  });

  /* ------------------------------- Health --------------------------------- */
  app.get('/health', { onRequest: [app.requirePermission('provider:read')] }, async () => {
    const queues = await queueHealth();
    const descriptors = allProviders().map((p) => ({
      key: p.descriptor.key,
      kind: p.descriptor.kind,
      configured: p.isConfigured(),
      missing: p.missingConfig(),
    }));
    return { queues, providers: descriptors };
  });
}

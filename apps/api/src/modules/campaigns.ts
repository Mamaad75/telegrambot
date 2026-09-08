import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WEBSITE_FILTERS } from '@baimar/shared';
import { recordAudit } from '../lib/audit-log';
import { badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { activeLeadSources } from '../providers/registry';
import { cancelRun, startCampaignRun } from '../services/campaign-service';

const campaignSchema = z.object({
  name: z.string().min(3).max(160),
  description: z.string().max(1000).optional(),
  country: z.string().length(2).default('IR'),
  province: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  area: z.string().max(80).optional(),
  categories: z.array(z.string().min(2).max(120)).min(1).max(20),
  keywords: z.array(z.string().max(120)).max(50).default([]),
  providers: z.array(z.string()).default([]),
  websiteFilter: z.enum(WEBSITE_FILTERS).default('ANY'),
  minLeadScore: z.number().int().min(0).max(100).nullable().optional(),
  maxResults: z.number().int().min(1).max(2000).default(200),
  enableAi: z.boolean().default(true),
  aiMinScore: z.number().int().min(0).max(100).default(65),
});

export default async function campaignRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.requirePermission('campaign:read')] }, async () => {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        runs: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { leads: true } },
      },
    });

    return {
      items: campaigns.map((c) => {
        const run = c.runs[0];
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          city: c.city,
          province: c.province,
          categories: c.categories,
          websiteFilter: c.websiteFilter,
          minLeadScore: c.minLeadScore,
          limit: c.maxResults,
          providers: c.providers,
          leadCount: c._count.leads,
          createdAt: c.createdAt,
          lastRunAt: c.lastRunAt,
          isDemo: c.isDemo,
          stats: run
            ? {
                collected: run.collected,
                unique: run.unique,
                qualified: run.qualified,
                hot: run.hot,
                warm: run.warm,
                medium: run.medium,
                low: run.low,
                rejected: run.rejected,
                errors: run.errors,
                merged: run.merged,
              }
            : null,
          currentRun: run
            ? { id: run.id, status: run.status, stage: run.stage, progress: run.progress, error: run.error }
            : null,
        };
      }),
    };
  });

  /** Which lead sources can actually be used right now, for the campaign builder. */
  app.get('/available-sources', { onRequest: [app.requirePermission('campaign:read')] }, async () => {
    const active = await activeLeadSources();
    const rows = await prisma.provider.findMany({ where: { kind: 'LEAD_SOURCE' } });

    return {
      items: rows.map((row) => {
        const provider = active.find((p) => p.descriptor.key === row.key);
        return {
          key: row.key,
          displayName: row.displayName,
          description: row.description,
          enabled: row.enabled,
          usable: Boolean(provider) && row.key !== 'manual',
          state: row.state,
          lastError: row.lastError,
        };
      }),
    };
  });

  app.get('/:id', { onRequest: [app.requirePermission('campaign:read')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 20 }, _count: { select: { leads: true } } },
    });
    if (!campaign) throw notFound('Campaign');

    const breakdown = await prisma.lead.groupBy({
      by: ['leadTemperature'],
      where: { campaignId: id },
      _count: true,
    });

    return {
      campaign: { ...campaign, leadCount: campaign._count.leads },
      temperatureBreakdown: breakdown.map((b) => ({ temperature: b.leadTemperature, count: b._count })),
    };
  });

  app.post('/', { onRequest: [app.requirePermission('campaign:create')] }, async (req) => {
    const body = campaignSchema.parse(req.body);
    const campaign = await prisma.campaign.create({
      data: { ...body, minLeadScore: body.minLeadScore ?? null, createdById: req.user!.id, status: 'READY' },
    });
    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'campaign.created',
      entityType: 'Campaign',
      entityId: campaign.id,
      after: { name: campaign.name, city: campaign.city, categories: campaign.categories },
      ip: req.ip,
    });
    return { campaign };
  });

  app.patch('/:id', { onRequest: [app.requirePermission('campaign:create')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = campaignSchema.partial().parse(req.body);

    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw notFound('Campaign');
    if (existing.status === 'RUNNING') throw badRequest('Cannot edit a campaign while it is running');

    const campaign = await prisma.campaign.update({ where: { id }, data: body });
    return { campaign };
  });

  app.post('/:id/run', { onRequest: [app.requirePermission('campaign:run')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);

    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw notFound('Campaign');

    const sources = await activeLeadSources(campaign.providers.length ? campaign.providers : undefined);
    if (!sources.some((s) => s.descriptor.key !== 'manual')) {
      throw badRequest(
        'No lead source provider is enabled and configured. Enable OpenStreetMap in Settings → Integrations, or add a Google Places / search API key.',
      );
    }

    const run = await startCampaignRun(id);
    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'campaign.run_started',
      entityType: 'Campaign',
      entityId: id,
      after: { runId: run.id },
      ip: req.ip,
    });
    return { run };
  });

  app.get('/:id/runs/:runId', { onRequest: [app.requirePermission('campaign:read')] }, async (req) => {
    const { runId } = z.object({ id: z.string(), runId: z.string() }).parse(req.params);
    const run = await prisma.campaignRun.findUnique({ where: { id: runId } });
    if (!run) throw notFound('Campaign run');
    return { run };
  });

  app.post('/:id/runs/:runId/cancel', { onRequest: [app.requirePermission('campaign:run')] }, async (req) => {
    const { runId } = z.object({ id: z.string(), runId: z.string() }).parse(req.params);
    await cancelRun(runId);
    return { ok: true };
  });

  app.delete('/:id', { onRequest: [app.requirePermission('campaign:delete')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw notFound('Campaign');
    if (campaign.status === 'RUNNING') throw badRequest('Stop the campaign before deleting it');

    // Leads survive the campaign; only the campaign link is removed.
    await prisma.lead.updateMany({ where: { campaignId: id }, data: { campaignId: null } });
    await prisma.campaign.delete({ where: { id } });

    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'campaign.deleted',
      entityType: 'Campaign',
      entityId: id,
      ip: req.ip,
    });
    return { ok: true };
  });
}

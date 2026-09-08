import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PIPELINE_ORDER, isRestrictedToAssigned } from '@baimar/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { leadVisibilityFilter } from '../plugins/auth';

/**
 * Dashboard aggregates.
 *
 * Everything is scoped by the caller's visibility, so a salesperson sees their own numbers
 * and a manager sees the team's. Demo rows are excluded unless explicitly requested, so the
 * KPI tiles never mix seeded data with real performance.
 */

/** Buckets used by the score-distribution chart. */
const SCORE_BUCKETS: Array<{ label: string; where: Prisma.IntNullableFilter | null }> = [
  { label: '80-100', where: { gte: 80 } },
  { label: '65-79', where: { gte: 65, lt: 80 } },
  { label: '45-64', where: { gte: 45, lt: 65 } },
  { label: '0-44', where: { lt: 45 } },
  { label: 'unscored', where: null },
];

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.authenticate] }, async (req) => {
    const query = z.object({ includeDemo: z.coerce.boolean().default(false), days: z.coerce.number().min(1).max(365).default(30) }).parse(req.query);
    const visibility = leadVisibilityFilter(req.user!);
    const base: Prisma.LeadWhereInput = { isArchived: false, ...(query.includeDemo ? {} : { isDemo: false }), ...visibility };

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const since = new Date(Date.now() - query.days * 24 * 3600 * 1000);

    const [
      totalLeads,
      hotLeads,
      warmLeads,
      readyToCall,
      callsToday,
      followUpsDue,
      followUpsOverdue,
      meetings,
      proposals,
      won,
      lost,
      noWebsite,
      audited,
      byStatus,
      byTemperature,
      byCity,
      byCategory,
      byService,
      bySource,
      recentHot,
      scoreBuckets,
    ] = await Promise.all([
      prisma.lead.count({ where: base }),
      prisma.lead.count({ where: { ...base, leadTemperature: 'HOT' } }),
      prisma.lead.count({ where: { ...base, leadTemperature: 'WARM' } }),
      prisma.lead.count({ where: { ...base, contactStatus: 'READY_TO_CALL' } }),
      prisma.call.count({
        where: { createdAt: { gte: startOfToday }, ...(isRestrictedToAssigned(req.user!.role) ? { userId: req.user!.id } : {}) },
      }),
      prisma.followUp.count({
        where: { completedAt: null, dueAt: { lte: new Date(Date.now() + 24 * 3600 * 1000) }, ...(isRestrictedToAssigned(req.user!.role) ? { userId: req.user!.id } : {}) },
      }),
      prisma.followUp.count({
        where: { completedAt: null, dueAt: { lt: new Date() }, ...(isRestrictedToAssigned(req.user!.role) ? { userId: req.user!.id } : {}) },
      }),
      prisma.lead.count({ where: { ...base, contactStatus: 'MEETING' } }),
      prisma.lead.count({ where: { ...base, contactStatus: { in: ['PROPOSAL', 'NEGOTIATION'] } } }),
      prisma.lead.count({ where: { ...base, contactStatus: 'WON' } }),
      prisma.lead.count({ where: { ...base, contactStatus: { in: ['LOST', 'NOT_INTERESTED'] } } }),
      prisma.lead.count({ where: { ...base, websiteStatus: { in: ['NO_WEBSITE', 'SOCIAL_ONLY'] } } }),
      prisma.lead.count({ where: { ...base, websiteAudits: { some: {} } } }),
      prisma.lead.groupBy({ by: ['contactStatus'], where: base, _count: true }),
      prisma.lead.groupBy({ by: ['leadTemperature'], where: base, _count: true }),
      prisma.lead.groupBy({ by: ['city'], where: { ...base, city: { not: null } }, _count: true, orderBy: { _count: { city: 'desc' } }, take: 10 }),
      prisma.lead.groupBy({ by: ['category'], where: { ...base, category: { not: null } }, _count: true, orderBy: { _count: { category: 'desc' } }, take: 10 }),
      prisma.lead.groupBy({ by: ['recommendedService'], where: { ...base, recommendedService: { not: null } }, _count: true, orderBy: { _count: { recommendedService: 'desc' } }, take: 10 }),
      prisma.leadSourceReference.groupBy({ by: ['providerKey'], _count: true, orderBy: { _count: { providerKey: 'desc' } }, take: 10 }),
      prisma.lead.findMany({
        where: { ...base, leadTemperature: 'HOT', contactStatus: { in: ['NEW', 'RESEARCHED', 'READY_TO_CALL'] } },
        orderBy: [{ leadScore: 'desc' }, { updatedAt: 'desc' }],
        take: 10,
        select: {
          id: true,
          businessName: true,
          city: true,
          leadScore: true,
          recommendedService: true,
          normalizedPhone: true,
          websiteStatus: true,
          businessValueTier: true,
        },
      }),
      // Score buckets as explicit range counts: keeps the visibility filter applied,
      // which a raw SQL aggregate would have to duplicate by hand.
      Promise.all(
        SCORE_BUCKETS.map(async (bucket) => ({
          bucket: bucket.label,
          count: await prisma.lead.count({ where: { ...base, leadScore: bucket.where } }),
        })),
      ),
    ]);

    const closed = won + lost;
    const conversionRate = closed > 0 ? Math.round((won / closed) * 1000) / 10 : null;

    const services = await prisma.service.findMany({ select: { key: true, nameFa: true } });
    const serviceName = new Map(services.map((s) => [s.key, s.nameFa]));

    const [newLeadsInPeriod, wonInPeriod] = await Promise.all([
      prisma.lead.count({ where: { ...base, createdAt: { gte: since } } }),
      prisma.lead.count({ where: { ...base, wonAt: { gte: since } } }),
    ]);

    return {
      kpis: {
        totalLeads,
        hotLeads,
        warmLeads,
        readyToCall,
        callsToday,
        followUpsDue,
        followUpsOverdue,
        meetings,
        proposals,
        won,
        lost,
        conversionRate,
        leadsWithoutWebsite: noWebsite,
        auditedLeads: audited,
        newLeadsInPeriod,
        wonInPeriod,
        periodDays: query.days,
      },
      charts: {
        pipeline: PIPELINE_ORDER.map((status) => ({
          status,
          count: byStatus.find((s) => s.contactStatus === status)?._count ?? 0,
        })),
        temperature: byTemperature.map((t) => ({ temperature: t.leadTemperature ?? 'UNSCORED', count: t._count })),
        cities: byCity.map((c) => ({ label: c.city!, count: c._count })),
        categories: byCategory.map((c) => ({ label: c.category!, count: c._count })),
        services: byService.map((s) => ({
          key: s.recommendedService!,
          label: serviceName.get(s.recommendedService!) ?? s.recommendedService!,
          count: s._count,
        })),
        sources: bySource.map((s) => ({ label: s.providerKey, count: s._count })),
        scoreDistribution: scoreBuckets,
        wonLost: [
          { label: 'برنده', count: won },
          { label: 'از دست رفته', count: lost },
        ],
      },
      hotList: recentHot.map((l) => ({
        ...l,
        recommendedServiceName: l.recommendedService ? serviceName.get(l.recommendedService) ?? null : null,
      })),
    };
  });

  /** "What should I do today" — the salesperson's landing view. */
  app.get('/today', { onRequest: [app.authenticate] }, async (req) => {
    const visibility = leadVisibilityFilter(req.user!);
    const mine = isRestrictedToAssigned(req.user!.role) ? { userId: req.user!.id } : {};

    const [dueFollowUps, overdueTasks, readyToCall] = await Promise.all([
      prisma.followUp.findMany({
        where: { completedAt: null, dueAt: { lte: new Date(Date.now() + 24 * 3600 * 1000) }, ...mine },
        orderBy: { dueAt: 'asc' },
        take: 20,
        include: { lead: { select: { id: true, businessName: true, city: true, normalizedPhone: true, leadScore: true, recommendedService: true } } },
      }),
      prisma.task.findMany({
        where: { status: 'OPEN', dueAt: { lt: new Date() }, ...(isRestrictedToAssigned(req.user!.role) ? { assignedToId: req.user!.id } : {}) },
        orderBy: { dueAt: 'asc' },
        take: 20,
        include: { lead: { select: { id: true, businessName: true } } },
      }),
      prisma.lead.findMany({
        where: {
          isArchived: false,
          isDemo: false,
          ...visibility,
          contactStatus: { in: ['NEW', 'RESEARCHED', 'READY_TO_CALL'] },
          leadTemperature: { in: ['HOT', 'WARM'] },
        },
        orderBy: [{ leadScore: 'desc' }],
        take: 15,
        select: {
          id: true,
          businessName: true,
          city: true,
          normalizedPhone: true,
          leadScore: true,
          leadTemperature: true,
          recommendedService: true,
          salesAngle: true,
          businessValueTier: true,
          websiteStatus: true,
        },
      }),
    ]);

    return { dueFollowUps, overdueTasks, readyToCall };
  });
}

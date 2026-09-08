import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CONTACT_STATUSES,
  LEAD_TEMPERATURES,
  WEBSITE_STATUSES,
  BUSINESS_VALUE_TIERS,
  isRestrictedToAssigned,
  normalizePhone,
} from '@baimar/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../lib/audit-log';
import { badRequest, notFound } from '../lib/errors';
import { jsonSafe, prisma } from '../lib/prisma';
import { assertLeadAccess, leadVisibilityFilter } from '../plugins/auth';
import { enqueue, enqueueLeadPipeline } from '../queue/queues';
import { exportLeadsCsv } from '../services/export-service';
import { importLeadsCsv, previewImport } from '../services/import-service';
import { findPossibleDuplicates, ingestBusiness, mergeLeads, normalizeLead } from '../services/lead-service';
import { recalculateLead, regenerateSalesBrief } from '../services/scoring-service';
import { auditLeadWebsite, discoverWebsiteForLead } from '../services/website-service';

const listQuerySchema = z.object({
  q: z.string().optional(),
  city: z.union([z.string(), z.array(z.string())]).optional(),
  province: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.union([z.string(), z.array(z.string())]).optional(),
  temperature: z.union([z.enum(LEAD_TEMPERATURES), z.array(z.enum(LEAD_TEMPERATURES))]).optional(),
  websiteStatus: z.union([z.enum(WEBSITE_STATUSES), z.array(z.enum(WEBSITE_STATUSES))]).optional(),
  contactStatus: z.union([z.enum(CONTACT_STATUSES), z.array(z.enum(CONTACT_STATUSES))]).optional(),
  businessValueTier: z.union([z.enum(BUSINESS_VALUE_TIERS), z.array(z.enum(BUSINESS_VALUE_TIERS))]).optional(),
  recommendedService: z.union([z.string(), z.array(z.string())]).optional(),
  assignedToId: z.union([z.string(), z.array(z.string())]).optional(),
  source: z.union([z.string(), z.array(z.string())]).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(100).optional(),
  websiteFilter: z.enum(['ANY', 'NO_WEBSITE', 'HAS_WEBSITE']).optional(),
  campaignId: z.string().optional(),
  unassigned: z.coerce.boolean().optional(),
  followUpDue: z.coerce.boolean().optional(),
  includeDemo: z.coerce.boolean().optional(),
  onlyDemo: z.coerce.boolean().optional(),
  includeArchived: z.coerce.boolean().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(25),
  sort: z.enum(['score_desc', 'value_desc', 'newest', 'oldest', 'followup_asc', 'name_asc']).default('score_desc'),
});

type ListQuery = z.infer<typeof listQuerySchema>;

const asArray = (v: string | string[] | undefined): string[] | undefined => {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  const filtered = arr.filter((x) => x !== '');
  return filtered.length ? filtered : undefined;
};

export function buildLeadWhere(query: ListQuery, visibility: { assignedToId?: string }): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { ...visibility };

  if (!query.includeArchived) where.isArchived = false;
  if (query.onlyDemo) where.isDemo = true;
  else if (!query.includeDemo) where.isDemo = false;

  if (query.q) {
    const q = query.q.trim();
    where.OR = [
      { businessName: { contains: q, mode: 'insensitive' } },
      { normalizedBusinessName: { contains: q, mode: 'insensitive' } },
      { normalizedPhone: { contains: q.replace(/\D/g, '') } },
      { websiteDomain: { contains: q, mode: 'insensitive' } },
      { address: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }

  const city = asArray(query.city);
  if (city) where.city = { in: city };
  const province = asArray(query.province);
  if (province) where.province = { in: province };
  const category = asArray(query.category);
  if (category) where.category = { in: category };
  const temperature = asArray(query.temperature);
  if (temperature) where.leadTemperature = { in: temperature as Prisma.EnumLeadTemperatureFilter['in'] };
  const websiteStatus = asArray(query.websiteStatus);
  if (websiteStatus) where.websiteStatus = { in: websiteStatus as Prisma.EnumWebsiteStatusFilter['in'] };
  const contactStatus = asArray(query.contactStatus);
  if (contactStatus) where.contactStatus = { in: contactStatus as Prisma.EnumContactStatusFilter['in'] };
  const valueTier = asArray(query.businessValueTier);
  if (valueTier) where.businessValueTier = { in: valueTier as Prisma.EnumBusinessValueTierFilter['in'] };
  const service = asArray(query.recommendedService);
  if (service) where.recommendedService = { in: service };
  const assignee = asArray(query.assignedToId);
  if (assignee) where.assignedToId = { in: assignee };
  if (query.unassigned) where.assignedToId = null;
  if (query.campaignId) where.campaignId = query.campaignId;

  const source = asArray(query.source);
  if (source) where.sourceReferences = { some: { providerKey: { in: source } } };

  if (query.minScore !== undefined || query.maxScore !== undefined) {
    where.leadScore = {
      ...(query.minScore !== undefined ? { gte: query.minScore } : {}),
      ...(query.maxScore !== undefined ? { lte: query.maxScore } : {}),
    };
  }

  if (query.websiteFilter === 'NO_WEBSITE') where.websiteStatus = { in: ['NO_WEBSITE', 'SOCIAL_ONLY'] };
  else if (query.websiteFilter === 'HAS_WEBSITE') where.websiteStatus = { in: ['ACTIVE', 'NOT_VERIFIED', 'PARKED'] };

  if (query.followUpDue) where.nextFollowUpAt = { lte: new Date() };

  return where;
}

function orderFor(sort: ListQuery['sort']): Prisma.LeadOrderByWithRelationInput[] {
  switch (sort) {
    case 'value_desc':
      return [{ businessValueScore: 'desc' }, { leadScore: 'desc' }];
    case 'newest':
      return [{ createdAt: 'desc' }];
    case 'oldest':
      return [{ createdAt: 'asc' }];
    case 'followup_asc':
      return [{ nextFollowUpAt: 'asc' }, { leadScore: 'desc' }];
    case 'name_asc':
      return [{ businessName: 'asc' }];
    default:
      return [{ leadScore: 'desc' }, { businessValueScore: 'desc' }, { createdAt: 'desc' }];
  }
}

const createSchema = z.object({
  businessName: z.string().min(2).max(200),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal('')),
  website: z.string().max(300).optional(),
  city: z.string().max(80).optional(),
  province: z.string().max(80).optional(),
  address: z.string().max(400).optional(),
  category: z.string().max(120).optional(),
  subcategory: z.string().max(120).optional(),
  instagramUrl: z.string().max(300).optional(),
  telegramUrl: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  services: z.array(z.string()).optional(),
  assignedToId: z.string().nullable().optional(),
});

const updateSchema = z.object({
  businessName: z.string().min(2).max(200).optional(),
  originalPhone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  website: z.string().max(300).nullable().optional(),
  websiteStatus: z.enum(WEBSITE_STATUSES).optional(),
  city: z.string().max(80).nullable().optional(),
  province: z.string().max(80).nullable().optional(),
  area: z.string().max(80).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  subcategory: z.string().max(120).nullable().optional(),
  instagramUrl: z.string().max(300).nullable().optional(),
  telegramUrl: z.string().max(300).nullable().optional(),
  linkedinUrl: z.string().max(300).nullable().optional(),
  whatsappUrl: z.string().max(300).nullable().optional(),
  googleMapsUrl: z.string().max(500).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  services: z.array(z.string()).optional(),
  products: z.array(z.string()).optional(),
  reviewCount: z.number().int().min(0).nullable().optional(),
  reviewRating: z.number().min(0).max(5).nullable().optional(),
  decisionMakerName: z.string().max(120).nullable().optional(),
  decisionMakerRole: z.string().max(120).nullable().optional(),
  contactStatus: z.enum(CONTACT_STATUSES).optional(),
  assignedToId: z.string().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  lostReason: z.string().max(500).nullable().optional(),
});

export default async function leadRoutes(app: FastifyInstance) {
  /* ------------------------------- List ---------------------------------- */
  app.get('/', { onRequest: [app.requirePermission('lead:read:all', 'lead:read:assigned')] }, async (req) => {
    const query = listQuerySchema.parse(req.query);
    const where = buildLeadWhere(query, leadVisibilityFilter(req.user!));

    const [total, items] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: orderFor(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { assignedTo: { select: { id: true, name: true } } },
      }),
    ]);

    const serviceKeys = Array.from(new Set(items.map((i) => i.recommendedService).filter(Boolean))) as string[];
    const services = serviceKeys.length
      ? await prisma.service.findMany({ where: { key: { in: serviceKeys } }, select: { key: true, nameFa: true } })
      : [];
    const serviceName = new Map(services.map((s) => [s.key, s.nameFa]));

    return {
      items: items.map((lead) => ({
        id: lead.id,
        businessName: lead.businessName,
        category: lead.category,
        city: lead.city,
        province: lead.province,
        normalizedPhone: lead.normalizedPhone,
        website: lead.website,
        websiteStatus: lead.websiteStatus,
        leadScore: lead.leadScore,
        leadTemperature: lead.leadTemperature,
        businessValueScore: lead.businessValueScore,
        businessValueTier: lead.businessValueTier,
        recommendedService: lead.recommendedService,
        recommendedServiceName: lead.recommendedService ? serviceName.get(lead.recommendedService) ?? null : null,
        contactStatus: lead.contactStatus,
        assignedToId: lead.assignedToId,
        assignedToName: lead.assignedTo?.name ?? null,
        nextFollowUpAt: lead.nextFollowUpAt,
        lastContactAt: lead.lastContactAt,
        isDemo: lead.isDemo,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  });

  /** Distinct values for the filter dropdowns, scoped to what the user can see. */
  app.get('/facets', { onRequest: [app.requirePermission('lead:read:all', 'lead:read:assigned')] }, async (req) => {
    const visibility = leadVisibilityFilter(req.user!);
    const base: Prisma.LeadWhereInput = { isArchived: false, ...visibility };

    const [cities, categories, services, users, sources] = await Promise.all([
      prisma.lead.groupBy({ by: ['city'], where: { ...base, city: { not: null } }, _count: true, orderBy: { _count: { city: 'desc' } }, take: 60 }),
      prisma.lead.groupBy({ by: ['category'], where: { ...base, category: { not: null } }, _count: true, orderBy: { _count: { category: 'desc' } }, take: 60 }),
      prisma.service.findMany({ where: { isActive: true }, select: { key: true, nameFa: true }, orderBy: { basePriority: 'desc' } }),
      prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.leadSourceReference.groupBy({ by: ['providerKey'], _count: true, orderBy: { _count: { providerKey: 'desc' } }, take: 20 }),
    ]);

    return {
      cities: cities.map((c) => ({ value: c.city!, count: c._count })),
      categories: categories.map((c) => ({ value: c.category!, count: c._count })),
      services: services.map((s) => ({ value: s.key, label: s.nameFa })),
      users: users.map((u) => ({ value: u.id, label: u.name })),
      sources: sources.map((s) => ({ value: s.providerKey, count: s._count })),
    };
  });

  /* ------------------------------ Export --------------------------------- */
  app.get('/export', { onRequest: [app.requirePermission('lead:export')] }, async (req, reply) => {
    const query = listQuerySchema.parse(req.query);
    const where = buildLeadWhere(query, leadVisibilityFilter(req.user!));
    const csv = await exportLeadsCsv(where);

    await recordAudit({ userId: req.user!.id, actorEmail: req.user!.email, action: 'lead.export', ip: req.ip });

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="baimar-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });

  /* ------------------------------ Detail --------------------------------- */
  app.get('/:id', { onRequest: [app.requirePermission('lead:read:all', 'lead:read:assigned')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await assertLeadAccess(req.user!, id);

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        campaign: { select: { id: true, name: true } },
        sourceReferences: { orderBy: { fetchedAt: 'desc' } },
        socialSignals: true,
        businessSignals: { orderBy: { key: 'asc' } },
        opportunities_: { orderBy: { score: 'desc' } },
        websiteAudits: { orderBy: { createdAt: 'desc' }, take: 3, include: { pages: true } },
        aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 3 },
        salesBriefs: { where: { isCurrent: true }, take: 1 },
        scores: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!lead) throw notFound('Lead');

    const services = await prisma.service.findMany({ select: { key: true, nameFa: true, nameEn: true } });
    const serviceMap = Object.fromEntries(services.map((s) => [s.key, s]));

    return jsonSafe({
      lead: {
        ...lead,
        recommendedServiceName: lead.recommendedService ? serviceMap[lead.recommendedService]?.nameFa ?? null : null,
      },
      services: serviceMap,
      currentBrief: lead.salesBriefs[0] ?? null,
      latestAudit: lead.websiteAudits[0] ?? null,
      latestAi: lead.aiAnalyses.find((a) => !a.error) ?? null,
    });
  });

  app.get('/:id/activity', { onRequest: [app.requirePermission('lead:read:all', 'lead:read:assigned')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await assertLeadAccess(req.user!, id);

    const [activities, calls, notes, tasks, followUps] = await Promise.all([
      prisma.salesActivity.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { name: true } } } }),
      prisma.call.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true } } } }),
      prisma.note.findMany({ where: { leadId: id }, orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], include: { user: { select: { name: true } } } }),
      prisma.task.findMany({ where: { leadId: id }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], include: { assignedTo: { select: { name: true } } } }),
      prisma.followUp.findMany({ where: { leadId: id }, orderBy: { dueAt: 'asc' } }),
    ]);

    return { activities, calls, notes, tasks, followUps };
  });

  app.get('/:id/duplicates', { onRequest: [app.requirePermission('lead:read:all')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const duplicates = await findPossibleDuplicates(id);
    return {
      items: duplicates.map((d) => ({
        rule: d.rule,
        evidence: d.evidence,
        lead: { id: d.lead.id, businessName: d.lead.businessName, city: d.lead.city, normalizedPhone: d.lead.normalizedPhone, websiteDomain: d.lead.websiteDomain },
      })),
    };
  });

  /* ------------------------------ Create --------------------------------- */
  app.post('/', { onRequest: [app.requirePermission('lead:create')] }, async (req) => {
    const body = createSchema.parse(req.body);

    const outcome = await ingestBusiness(
      {
        providerKey: 'manual',
        origin: 'MANUAL_ENTRY',
        name: body.businessName,
        phone: body.phone,
        email: body.email || undefined,
        website: body.website,
        city: body.city,
        province: body.province,
        address: body.address,
        category: body.category,
        subcategory: body.subcategory,
        instagramUrl: body.instagramUrl,
        telegramUrl: body.telegramUrl,
        description: body.description,
        services: body.services,
        country: 'IR',
      },
      { createdById: req.user!.id },
    );

    if (outcome.action === 'rejected') throw badRequest(outcome.reason);

    if (body.assignedToId && outcome.action === 'created') {
      await prisma.lead.update({ where: { id: outcome.lead.id }, data: { assignedToId: body.assignedToId } });
    }

    await recalculateLead(outcome.lead.id).catch(() => undefined);
    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: outcome.action === 'created' ? 'lead.created' : 'lead.merged_on_create',
      entityType: 'Lead',
      entityId: outcome.lead.id,
      ip: req.ip,
    });

    return { action: outcome.action, lead: outcome.lead, ...(outcome.action === 'merged' ? { evidence: outcome.evidence } : {}) };
  });

  /* ------------------------------ Update --------------------------------- */
  app.patch('/:id', { onRequest: [app.requirePermission('lead:update')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await assertLeadAccess(req.user!, id);
    const body = updateSchema.parse(req.body);

    const before = await prisma.lead.findUnique({ where: { id } });
    if (!before) throw notFound('Lead');

    // A salesperson may move their own leads through the pipeline but not reassign them.
    if (body.assignedToId !== undefined && isRestrictedToAssigned(req.user!.role)) {
      throw badRequest('Only a manager can reassign a lead');
    }

    const data: Prisma.LeadUpdateInput = { ...body } as Prisma.LeadUpdateInput;
    if (body.email === '') data.email = null;
    if (body.nextFollowUpAt !== undefined) {
      data.nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
    }
    if (body.assignedToId !== undefined) {
      data.assignedTo = body.assignedToId ? { connect: { id: body.assignedToId } } : { disconnect: true };
      delete (data as Record<string, unknown>).assignedToId;
    }
    if (body.contactStatus) {
      if (body.contactStatus === 'WON') data.wonAt = new Date();
      if (body.contactStatus === 'LOST' || body.contactStatus === 'NOT_INTERESTED') data.lostAt = new Date();
      if (['CONTACTED', 'NO_ANSWER', 'CALLBACK', 'INTERESTED', 'MEETING'].includes(body.contactStatus)) {
        data.lastContactAt = new Date();
      }
    }

    const lead = await prisma.lead.update({ where: { id }, data });

    // Editing identity or contact fields invalidates the normalized columns.
    if (body.businessName || body.originalPhone !== undefined || body.website !== undefined || body.city !== undefined) {
      await normalizeLead(id);
    }

    if (body.contactStatus && body.contactStatus !== before.contactStatus) {
      await prisma.salesActivity.create({
        data: {
          leadId: id,
          userId: req.user!.id,
          type: 'STATUS_CHANGE',
          title: `تغییر وضعیت: ${before.contactStatus} ← ${body.contactStatus}`,
          metadata: { from: before.contactStatus, to: body.contactStatus },
        },
      });
    }
    if (body.assignedToId !== undefined && body.assignedToId !== before.assignedToId) {
      await prisma.salesActivity.create({
        data: {
          leadId: id,
          userId: req.user!.id,
          type: 'ASSIGNMENT',
          title: body.assignedToId ? 'واگذاری سرنخ' : 'لغو واگذاری سرنخ',
          metadata: { from: before.assignedToId, to: body.assignedToId },
        },
      });
      if (body.assignedToId) {
        await enqueue('send_notification', {
          event: 'LEAD_ASSIGNED',
          title: `سرنخ جدید به شما واگذار شد: ${lead.businessName}`,
          body: `امتیاز ${lead.leadScore ?? '—'} • ${lead.city ?? 'شهر نامشخص'}`,
          userIds: [body.assignedToId],
          leadId: id,
          url: `/leads/${id}`,
        });
      }
    }

    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'lead.updated',
      entityType: 'Lead',
      entityId: id,
      before: { contactStatus: before.contactStatus, assignedToId: before.assignedToId },
      after: { contactStatus: lead.contactStatus, assignedToId: lead.assignedToId },
      ip: req.ip,
    });

    return { lead };
  });

  app.delete('/:id', { onRequest: [app.requirePermission('lead:delete')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    // Archive rather than delete: a removed lead must remain auditable.
    const lead = await prisma.lead.update({ where: { id }, data: { isArchived: true } });
    await recordAudit({ userId: req.user!.id, actorEmail: req.user!.email, action: 'lead.archived', entityType: 'Lead', entityId: id, ip: req.ip });
    return { lead };
  });

  app.post('/:id/merge', { onRequest: [app.requirePermission('lead:update')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { duplicateId } = z.object({ duplicateId: z.string() }).parse(req.body);
    const lead = await mergeLeads(id, duplicateId);
    await recalculateLead(id).catch(() => undefined);
    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'lead.merged',
      entityType: 'Lead',
      entityId: id,
      after: { mergedFrom: duplicateId },
      ip: req.ip,
    });
    return { lead };
  });

  /* --------------------------- Pipeline actions --------------------------- */
  app.post('/:id/discover-website', { onRequest: [app.requirePermission('lead:run_audit')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { async: runAsync = true, force } = z.object({ async: z.boolean().optional(), force: z.boolean().optional() }).parse(req.body ?? {});

    if (runAsync) {
      const jobId = await enqueue('discover_website', { leadId: id, force });
      if (jobId) return { queued: true, jobId };
    }
    const result = await discoverWebsiteForLead(id, { force });
    return { queued: false, result };
  });

  app.post('/:id/audit', { onRequest: [app.requirePermission('lead:run_audit')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { async: runAsync = true, force } = z.object({ async: z.boolean().optional(), force: z.boolean().optional() }).parse(req.body ?? {});

    if (runAsync) {
      const jobId = await enqueue('audit_website', { leadId: id, force });
      await enqueue('calculate_score', { leadId: id, notifyIfHot: true }, { delay: 3000 });
      if (jobId) return { queued: true, jobId };
    }
    const result = await auditLeadWebsite(id, { force });
    await recalculateLead(id);
    return { queued: false, auditId: result.audit?.id ?? null, skipped: result.skipped };
  });

  app.post('/:id/rescore', { onRequest: [app.requirePermission('lead:update')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await assertLeadAccess(req.user!, id);
    const result = await recalculateLead(id);
    if (!result) throw notFound('Lead');
    return {
      score: result.score.score,
      temperature: result.score.temperature,
      contributions: result.score.contributions,
      businessValue: result.businessValue,
      recommendedService: result.primary?.serviceKey ?? null,
    };
  });

  app.post('/:id/analyze', { onRequest: [app.requirePermission('lead:run_ai')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { force } = z.object({ force: z.boolean().optional() }).parse(req.body ?? {});
    const jobId = await enqueue('analyze_lead', { leadId: id, force });
    if (!jobId) throw badRequest('The job queue is unavailable; start Redis and the worker process');
    return { queued: true, jobId };
  });

  app.post('/:id/regenerate-brief', { onRequest: [app.requirePermission('lead:update')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await assertLeadAccess(req.user!, id);
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw notFound('Lead');
    await regenerateSalesBrief(lead);
    const brief = await prisma.salesBrief.findFirst({ where: { leadId: id, isCurrent: true } });
    return { brief };
  });

  /* ----------------------------- Bulk actions ----------------------------- */
  const bulkSchema = z.object({
    leadIds: z.array(z.string()).min(1).max(500),
    action: z.enum(['assign', 'status', 'audit', 'analyze', 'rescore', 'follow_up', 'archive']),
    assignedToId: z.string().nullable().optional(),
    contactStatus: z.enum(CONTACT_STATUSES).optional(),
    followUpAt: z.string().datetime().optional(),
    followUpKind: z.string().max(120).optional(),
  });

  app.post('/bulk', { onRequest: [app.requirePermission('lead:update')] }, async (req) => {
    const body = bulkSchema.parse(req.body);
    const user = req.user!;

    switch (body.action) {
      case 'assign': {
        if (isRestrictedToAssigned(user.role)) throw badRequest('Only a manager can assign leads');
        await prisma.lead.updateMany({ where: { id: { in: body.leadIds } }, data: { assignedToId: body.assignedToId ?? null } });
        if (body.assignedToId) {
          await enqueue('send_notification', {
            event: 'LEAD_ASSIGNED',
            title: `${body.leadIds.length} سرنخ به شما واگذار شد`,
            userIds: [body.assignedToId],
            url: '/leads?assignedToId=me',
          });
        }
        break;
      }
      case 'status': {
        if (!body.contactStatus) throw badRequest('contactStatus is required for this action');
        await prisma.lead.updateMany({ where: { id: { in: body.leadIds } }, data: { contactStatus: body.contactStatus } });
        break;
      }
      case 'audit':
        for (const leadId of body.leadIds) await enqueue('audit_website', { leadId });
        break;
      case 'analyze':
        for (const leadId of body.leadIds) await enqueue('analyze_lead', { leadId });
        break;
      case 'rescore':
        for (const leadId of body.leadIds) await enqueue('calculate_score', { leadId });
        break;
      case 'follow_up': {
        if (!body.followUpAt) throw badRequest('followUpAt is required for this action');
        const dueAt = new Date(body.followUpAt);
        await prisma.followUp.createMany({
          data: body.leadIds.map((leadId) => ({ leadId, userId: user.id, kind: body.followUpKind ?? 'تماس مجدد', dueAt })),
        });
        await prisma.lead.updateMany({ where: { id: { in: body.leadIds } }, data: { nextFollowUpAt: dueAt } });
        break;
      }
      case 'archive':
        await prisma.lead.updateMany({ where: { id: { in: body.leadIds } }, data: { isArchived: true } });
        break;
    }

    await recordAudit({
      userId: user.id,
      actorEmail: user.email,
      action: `lead.bulk_${body.action}`,
      after: { count: body.leadIds.length },
      ip: req.ip,
    });

    return { ok: true, affected: body.leadIds.length };
  });

  /* -------------------------------- Import -------------------------------- */
  app.post('/import/preview', { onRequest: [app.requirePermission('lead:import')] }, async (req) => {
    const { content } = z.object({ content: z.string().min(1) }).parse(req.body);
    return previewImport(content);
  });

  app.post('/import', { onRequest: [app.requirePermission('lead:import')] }, async (req) => {
    const body = z
      .object({
        content: z.string().min(1),
        filename: z.string().optional(),
        mapping: z.record(z.string().nullable()).optional(),
        campaignId: z.string().optional(),
        defaultCity: z.string().optional(),
        defaultCategory: z.string().optional(),
        runPipeline: z.boolean().default(true),
      })
      .parse(req.body);

    const result = await importLeadsCsv(body.content, {
      filename: body.filename,
      createdById: req.user!.id,
      mapping: body.mapping as never,
      campaignId: body.campaignId,
      defaultCity: body.defaultCity,
      defaultCategory: body.defaultCategory,
    });

    if (body.runPipeline) {
      const recent = await prisma.lead.findMany({
        where: { createdById: req.user!.id, createdAt: { gte: new Date(Date.now() - 5 * 60_000) } },
        select: { id: true },
        take: 500,
      });
      let i = 0;
      for (const lead of recent) {
        await enqueueLeadPipeline(lead.id, { delayMs: i * 1500 });
        i++;
      }
    }

    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'lead.import',
      after: { imported: result.imported, merged: result.merged, skipped: result.skipped },
      ip: req.ip,
    });

    return result;
  });

  /** Normalize a phone number without saving — used by the lead form for live feedback. */
  app.post('/normalize-phone', { onRequest: [app.authenticate] }, async (req) => {
    const { phone } = z.object({ phone: z.string() }).parse(req.body);
    return normalizePhone(phone);
  });
}

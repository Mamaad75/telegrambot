import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { queueHealth } from '../queue/queues';
import { redisHealthy } from '../lib/redis';

/**
 * Observability: the activity log, the job log and queue health.
 * Everything an administrator needs to answer "what has this thing been doing?".
 */

export default async function adminRoutes(app: FastifyInstance) {
  app.get('/audit-logs', { onRequest: [app.requirePermission('audit_log:read')] }, async (req) => {
    const query = z
      .object({
        action: z.string().optional(),
        userId: z.string().optional(),
        entityType: z.string().optional(),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(200).default(50),
      })
      .parse(req.query);

    const where = {
      ...(query.action ? { action: { contains: query.action } } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { name: true, email: true } } },
      }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  });

  app.get('/jobs', { onRequest: [app.requirePermission('provider:read')] }, async (req) => {
    const query = z
      .object({
        status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']).optional(),
        jobName: z.string().optional(),
        limit: z.coerce.number().min(1).max(200).default(50),
      })
      .parse(req.query);

    const [items, failedCount, queues, redisOk] = await Promise.all([
      prisma.jobLog.findMany({
        where: { ...(query.status ? { status: query.status } : {}), ...(query.jobName ? { jobName: query.jobName } : {}) },
        orderBy: { startedAt: 'desc' },
        take: query.limit,
      }),
      prisma.jobLog.count({ where: { status: 'FAILED', startedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
      queueHealth(),
      redisHealthy(),
    ]);

    return { items, failedLast24h: failedCount, queues, redisOk };
  });

  app.get('/imports', { onRequest: [app.requirePermission('lead:import')] }, async () => {
    const items = await prisma.importBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { createdBy: { select: { name: true } } },
    });
    return { items };
  });

  /** System-wide counts, for the admin landing page. */
  app.get('/stats', { onRequest: [app.requirePermission('settings:read')] }, async () => {
    const [leads, demoLeads, campaigns, audits, aiAnalyses, keywords, searchTerms, users, notifications] = await Promise.all([
      prisma.lead.count({ where: { isDemo: false } }),
      prisma.lead.count({ where: { isDemo: true } }),
      prisma.campaign.count(),
      prisma.websiteAudit.count(),
      prisma.aIAnalysis.count({ where: { error: null } }),
      prisma.keyword.count(),
      prisma.searchTerm.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.notification.count(),
    ]);

    return { leads, demoLeads, campaigns, audits, aiAnalyses, keywords, searchTerms, users, notifications };
  });
}

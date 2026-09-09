import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SCORING_SIGNALS } from '@baimar/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../lib/audit-log';
import { conflict, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';

/**
 * The Baimar service catalogue.
 *
 * Services and their matching rules are data, not code: an administrator can add a new
 * offering, describe when it applies, and the opportunity engine starts recommending it
 * without a deployment.
 */

const ruleSchema = z.object({
  requiresAll: z.array(z.enum(SCORING_SIGNALS)).optional(),
  requiresAny: z.array(z.enum(SCORING_SIGNALS)).optional(),
  excludes: z.array(z.enum(SCORING_SIGNALS)).optional(),
  points: z.number().min(0).max(200),
  reasonFa: z.string().min(3).max(300),
  reasonEn: z.string().min(3).max(300),
});

const serviceSchema = z.object({
  key: z.string().regex(/^[A-Z0-9_]{2,40}$/, 'Key must be uppercase letters, digits and underscores'),
  nameFa: z.string().min(2).max(120),
  nameEn: z.string().min(2).max(120),
  descriptionFa: z.string().max(1000).optional(),
  basePriority: z.number().int().min(0).max(200).default(50),
  isActive: z.boolean().default(true),
  rules: z.array(ruleSchema).default([]),
  salesAngles: z.array(z.string().max(300)).default([]),
  commonObjections: z.array(z.string().max(300)).default([]),
  objectionResponses: z.array(z.string().max(600)).default([]),
  discoveryQuestions: z.array(z.string().max(300)).default([]),
  matchKeywords: z.array(z.string().max(120)).max(60).default([]),
});

export default async function serviceRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.authenticate] }, async () => {
    const services = await prisma.service.findMany({
      orderBy: [{ isActive: 'desc' }, { basePriority: 'desc' }],
      include: { _count: { select: { opportunities: true } } },
    });
    return {
      items: services.map((s) => ({ ...s, opportunityCount: s._count.opportunities })),
      signals: SCORING_SIGNALS,
    };
  });

  app.post('/', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const body = serviceSchema.parse(req.body);
    const existing = await prisma.service.findUnique({ where: { key: body.key } });
    if (existing) throw conflict('A service with this key already exists');

    const service = await prisma.service.create({
      data: { ...body, rules: body.rules as unknown as Prisma.InputJsonValue },
    });
    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'service.created',
      entityType: 'Service',
      entityId: service.id,
      after: { key: service.key },
      ip: req.ip,
    });
    return { service };
  });

  app.patch('/:id', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = serviceSchema.partial().omit({ key: true }).parse(req.body);

    const existing = await prisma.service.findUnique({ where: { id } });
    if (!existing) throw notFound('Service');

    const data: Prisma.ServiceUpdateInput = { ...body } as Prisma.ServiceUpdateInput;
    if (body.rules) data.rules = body.rules as unknown as Prisma.InputJsonValue;

    const service = await prisma.service.update({ where: { id }, data });
    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'service.updated',
      entityType: 'Service',
      entityId: id,
      ip: req.ip,
    });
    return { service };
  });

  app.delete('/:id', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    // Deactivate rather than delete: existing leads reference the service key.
    const service = await prisma.service.update({ where: { id }, data: { isActive: false } });
    return { service };
  });
}

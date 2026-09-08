import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CALL_OUTCOMES, TASK_PRIORITIES, TASK_STATUSES, isRestrictedToAssigned } from '@baimar/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { assertLeadAccess } from '../plugins/auth';

/**
 * CRM: notes, calls, tasks and follow-ups.
 *
 * Logging a call is the one action that must be effortless on a phone, so it also advances
 * the lead's pipeline status and schedules the next follow-up in a single request.
 */

/** Call outcomes that imply a pipeline stage. */
const OUTCOME_TO_STATUS: Partial<Record<(typeof CALL_OUTCOMES)[number], Prisma.LeadUpdateInput['contactStatus']>> = {
  ANSWERED: 'CONTACTED',
  NO_ANSWER: 'NO_ANSWER',
  BUSY: 'NO_ANSWER',
  CALLBACK_REQUESTED: 'CALLBACK',
  NOT_INTERESTED: 'NOT_INTERESTED',
  INTERESTED: 'INTERESTED',
  MEETING_SET: 'MEETING',
  WRONG_NUMBER: undefined,
};

export default async function crmRoutes(app: FastifyInstance) {
  /* -------------------------------- Notes -------------------------------- */
  app.post('/leads/:leadId/notes', { onRequest: [app.requirePermission('crm:write')] }, async (req) => {
    const { leadId } = z.object({ leadId: z.string() }).parse(req.params);
    await assertLeadAccess(req.user!, leadId);
    const body = z.object({ body: z.string().min(1).max(5000), isPinned: z.boolean().optional() }).parse(req.body);

    const note = await prisma.note.create({
      data: { leadId, userId: req.user!.id, body: body.body, isPinned: body.isPinned ?? false },
    });
    await prisma.salesActivity.create({
      data: { leadId, userId: req.user!.id, type: 'NOTE', title: 'یادداشت جدید', body: body.body.slice(0, 300) },
    });
    return { note };
  });

  app.patch('/notes/:id', { onRequest: [app.requirePermission('crm:write')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ body: z.string().min(1).max(5000).optional(), isPinned: z.boolean().optional() }).parse(req.body);
    const note = await prisma.note.update({ where: { id }, data: body });
    return { note };
  });

  app.delete('/notes/:id', { onRequest: [app.requirePermission('crm:write')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.note.delete({ where: { id } });
    return { ok: true };
  });

  /* -------------------------------- Calls -------------------------------- */
  const callSchema = z.object({
    outcome: z.enum(CALL_OUTCOMES),
    durationSeconds: z.number().int().min(0).max(60 * 60 * 8).optional(),
    notes: z.string().max(5000).optional(),
    phone: z.string().max(40).optional(),
    nextActionAt: z.string().datetime().optional(),
    nextActionKind: z.string().max(120).optional(),
    /** Explicit override; otherwise the outcome decides the new pipeline stage. */
    contactStatus: z.string().optional(),
  });

  app.post('/leads/:leadId/calls', { onRequest: [app.requirePermission('crm:write')] }, async (req) => {
    const { leadId } = z.object({ leadId: z.string() }).parse(req.params);
    await assertLeadAccess(req.user!, leadId);
    const body = callSchema.parse(req.body);

    const call = await prisma.call.create({
      data: {
        leadId,
        userId: req.user!.id,
        outcome: body.outcome,
        durationSeconds: body.durationSeconds ?? null,
        notes: body.notes ?? null,
        phone: body.phone ?? null,
        nextActionAt: body.nextActionAt ? new Date(body.nextActionAt) : null,
      },
    });

    const leadUpdate: Prisma.LeadUpdateInput = { lastContactAt: new Date() };
    const derivedStatus = (body.contactStatus as Prisma.LeadUpdateInput['contactStatus']) ?? OUTCOME_TO_STATUS[body.outcome];
    if (derivedStatus) leadUpdate.contactStatus = derivedStatus;
    if (body.outcome === 'NOT_INTERESTED') leadUpdate.lostAt = new Date();

    if (body.nextActionAt) {
      const dueAt = new Date(body.nextActionAt);
      leadUpdate.nextFollowUpAt = dueAt;
      await prisma.followUp.create({
        data: { leadId, userId: req.user!.id, kind: body.nextActionKind ?? 'تماس مجدد', dueAt, notes: body.notes ?? null },
      });
    }

    await prisma.lead.update({ where: { id: leadId }, data: leadUpdate });
    await prisma.salesActivity.create({
      data: {
        leadId,
        userId: req.user!.id,
        type: 'CALL',
        title: `تماس — ${body.outcome}`,
        body: body.notes ?? null,
        metadata: { outcome: body.outcome, durationSeconds: body.durationSeconds ?? null },
      },
    });

    return { call };
  });

  /* -------------------------------- Tasks -------------------------------- */
  const taskSchema = z.object({
    leadId: z.string().optional(),
    title: z.string().min(2).max(200),
    description: z.string().max(2000).optional(),
    priority: z.enum(TASK_PRIORITIES).default('NORMAL'),
    dueAt: z.string().datetime().optional(),
    assignedToId: z.string().optional(),
  });

  app.get('/tasks', { onRequest: [app.requirePermission('crm:write')] }, async (req) => {
    const query = z
      .object({
        status: z.enum(TASK_STATUSES).optional(),
        assignedToId: z.string().optional(),
        overdue: z.coerce.boolean().optional(),
        mine: z.coerce.boolean().optional(),
        limit: z.coerce.number().min(1).max(200).default(50),
      })
      .parse(req.query);

    const where: Prisma.TaskWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.overdue) {
      where.status = 'OPEN';
      where.dueAt = { lt: new Date() };
    }
    if (query.mine || isRestrictedToAssigned(req.user!.role)) where.assignedToId = req.user!.id;
    else if (query.assignedToId) where.assignedToId = query.assignedToId;

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: query.limit,
      include: { lead: { select: { id: true, businessName: true } }, assignedTo: { select: { id: true, name: true } } },
    });

    const now = Date.now();
    return {
      items: tasks.map((t) => ({
        id: t.id,
        leadId: t.leadId,
        leadName: t.lead?.businessName ?? null,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt,
        completedAt: t.completedAt,
        assignedToId: t.assignedToId,
        assignedToName: t.assignedTo?.name ?? null,
        isOverdue: t.status === 'OPEN' && Boolean(t.dueAt) && t.dueAt!.getTime() < now,
      })),
    };
  });

  app.post('/tasks', { onRequest: [app.requirePermission('crm:write')] }, async (req) => {
    const body = taskSchema.parse(req.body);
    if (body.leadId) await assertLeadAccess(req.user!, body.leadId);

    const task = await prisma.task.create({
      data: {
        leadId: body.leadId ?? null,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        assignedToId: body.assignedToId ?? req.user!.id,
        createdById: req.user!.id,
      },
    });
    return { task };
  });

  app.patch('/tasks/:id', { onRequest: [app.requirePermission('crm:write')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        title: z.string().min(2).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        status: z.enum(TASK_STATUSES).optional(),
        priority: z.enum(TASK_PRIORITIES).optional(),
        dueAt: z.string().datetime().nullable().optional(),
        assignedToId: z.string().nullable().optional(),
      })
      .parse(req.body);

    const data: Prisma.TaskUpdateInput = { ...body } as Prisma.TaskUpdateInput;
    if (body.dueAt !== undefined) data.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    if (body.status === 'DONE') data.completedAt = new Date();
    if (body.assignedToId !== undefined) {
      data.assignedTo = body.assignedToId ? { connect: { id: body.assignedToId } } : { disconnect: true };
      delete (data as Record<string, unknown>).assignedToId;
    }

    const task = await prisma.task.update({ where: { id }, data });
    return { task };
  });

  /* ------------------------------ Follow-ups ------------------------------ */
  app.get('/follow-ups', { onRequest: [app.requirePermission('crm:write')] }, async (req) => {
    const query = z
      .object({
        due: z.coerce.boolean().optional(),
        mine: z.coerce.boolean().optional(),
        limit: z.coerce.number().min(1).max(200).default(50),
      })
      .parse(req.query);

    const where: Prisma.FollowUpWhereInput = { completedAt: null };
    if (query.due) where.dueAt = { lte: new Date() };
    if (query.mine || isRestrictedToAssigned(req.user!.role)) where.userId = req.user!.id;

    const followUps = await prisma.followUp.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      take: query.limit,
      include: { lead: { select: { id: true, businessName: true, city: true, normalizedPhone: true, leadScore: true } } },
    });
    return { items: followUps };
  });

  app.post('/leads/:leadId/follow-ups', { onRequest: [app.requirePermission('crm:write')] }, async (req) => {
    const { leadId } = z.object({ leadId: z.string() }).parse(req.params);
    await assertLeadAccess(req.user!, leadId);
    const body = z
      .object({ kind: z.string().min(2).max(120), dueAt: z.string().datetime(), notes: z.string().max(2000).optional() })
      .parse(req.body);

    const dueAt = new Date(body.dueAt);
    const followUp = await prisma.followUp.create({
      data: { leadId, userId: req.user!.id, kind: body.kind, dueAt, notes: body.notes ?? null },
    });
    await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: dueAt } });
    await prisma.salesActivity.create({
      data: { leadId, userId: req.user!.id, type: 'FOLLOW_UP', title: `پیگیری: ${body.kind}`, body: body.notes ?? null },
    });
    return { followUp };
  });

  app.post('/follow-ups/:id/complete', { onRequest: [app.requirePermission('crm:write')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const followUp = await prisma.followUp.update({ where: { id }, data: { completedAt: new Date() } });

    // Point the lead at its next open follow-up, if any.
    const next = await prisma.followUp.findFirst({
      where: { leadId: followUp.leadId, completedAt: null },
      orderBy: { dueAt: 'asc' },
    });
    await prisma.lead.update({ where: { id: followUp.leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } });

    return { followUp };
  });
}

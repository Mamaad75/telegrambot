import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLES } from '@baimar/shared';
import { recordAudit } from '../lib/audit-log';
import { hashPassword, validatePasswordStrength } from '../lib/crypto';
import { badRequest, conflict, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { logoutEverywhere } from '../services/auth-service';
import { publicUser } from './auth';

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(120),
  password: z.string().min(10),
  role: z.enum(ROLES),
  phone: z.string().max(32).optional(),
  telegramChatId: z.string().max(64).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  phone: z.string().max(32).nullable().optional(),
  telegramChatId: z.string().max(64).nullable().optional(),
});

export default async function userRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.requirePermission('user:read')] }, async () => {
    const users = await prisma.user.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { assignedLeads: true } } },
    });
    return {
      items: users.map((u) => ({
        ...publicUser(u),
        phone: u.phone,
        lastLoginAt: u.lastLoginAt,
        assignedLeadCount: u._count.assignedLeads,
        createdAt: u.createdAt,
      })),
    };
  });

  app.post('/', { onRequest: [app.requirePermission('user:manage')] }, async (req) => {
    const body = createSchema.parse(req.body);
    const problem = validatePasswordStrength(body.password);
    if (problem) throw badRequest(problem);

    const email = body.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw conflict('A user with this e-mail already exists');

    const user = await prisma.user.create({
      data: {
        email,
        name: body.name,
        role: body.role,
        phone: body.phone,
        telegramChatId: body.telegramChatId,
        passwordHash: await hashPassword(body.password),
      },
    });

    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'user.created',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, role: user.role },
      ip: req.ip,
    });

    return { user: publicUser(user) };
  });

  app.patch('/:id', { onRequest: [app.requirePermission('user:manage')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = updateSchema.parse(req.body);

    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) throw notFound('User');

    // The last active administrator cannot lock themselves out.
    if ((body.role && body.role !== 'ADMIN') || body.isActive === false) {
      if (before.role === 'ADMIN') {
        const otherAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true, id: { not: id } } });
        if (otherAdmins === 0) throw badRequest('At least one active administrator must remain');
      }
    }

    const user = await prisma.user.update({ where: { id }, data: body });
    if (body.isActive === false) await logoutEverywhere(id);

    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'user.updated',
      entityType: 'User',
      entityId: id,
      before: { role: before.role, isActive: before.isActive },
      after: { role: user.role, isActive: user.isActive },
      ip: req.ip,
    });

    return { user: publicUser(user) };
  });

  app.post('/:id/reset-password', { onRequest: [app.requirePermission('user:manage')] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { password } = z.object({ password: z.string().min(10) }).parse(req.body);

    const problem = validatePasswordStrength(password);
    if (problem) throw badRequest(problem);

    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
    await logoutEverywhere(id);

    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'user.password_reset',
      entityType: 'User',
      entityId: id,
      ip: req.ip,
    });

    return { ok: true };
  });
}

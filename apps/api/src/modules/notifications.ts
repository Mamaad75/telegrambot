import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { availableNotificationChannels, notify } from '../services/notification-service';

export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.authenticate] }, async (req) => {
    const query = z
      .object({ unreadOnly: z.coerce.boolean().default(false), limit: z.coerce.number().min(1).max(100).default(30) })
      .parse(req.query);

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user!.id, channel: 'IN_APP', ...(query.unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
      prisma.notification.count({ where: { userId: req.user!.id, channel: 'IN_APP', readAt: null } }),
    ]);

    return { items, unreadCount, channels: await availableNotificationChannels() };
  });

  app.post('/:id/read', { onRequest: [app.authenticate] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.notification.updateMany({ where: { id, userId: req.user!.id }, data: { readAt: new Date() } });
    return { ok: true };
  });

  app.post('/read-all', { onRequest: [app.authenticate] }, async (req) => {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, marked: result.count };
  });

  /** Send a test message so an administrator can verify Telegram/e-mail wiring. */
  app.post('/test', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const body = z.object({ channel: z.enum(['TELEGRAM', 'EMAIL', 'IN_APP']).default('IN_APP') }).parse(req.body ?? {});
    const result = await notify({
      event: 'DAILY_SUMMARY',
      title: 'پیام آزمایشی بایمر',
      body: 'اگر این پیام را دریافت کردید، اتصال اعلان‌ها درست کار می‌کند.',
      userIds: [req.user!.id],
      channels: body.channel === 'IN_APP' ? [] : [body.channel],
    });
    return result;
  });
}

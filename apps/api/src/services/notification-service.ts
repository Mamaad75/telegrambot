import { Prisma, type NotificationChannel, type NotificationEvent, type User } from '@prisma/client';
import { loadEnv } from '../config/env';
import { prisma } from '../lib/prisma';
import { getNotificationSettings } from '../lib/settings';
import { activeNotificationProviders, callProvider, findProvider } from '../providers/registry';
import type { NotificationProvider } from '../providers/types';

/**
 * Notification dispatch.
 *
 * The in-app record is written first and always: even when Telegram is down or not
 * configured, the notification exists in the bell menu. External channels are then
 * attempted independently, and a channel failure is recorded on its own row rather than
 * failing the whole dispatch.
 */

export interface NotifyInput {
  event: NotificationEvent;
  title: string;
  body?: string;
  /** Specific recipients. When omitted, the event's default audience is used. */
  userIds?: string[];
  leadId?: string;
  url?: string;
  payload?: Record<string, unknown>;
  /** Channels to try in addition to the in-app record. */
  channels?: NotificationChannel[];
}

export async function notify(input: NotifyInput): Promise<{ delivered: number; failures: string[] }> {
  const settings = await getNotificationSettings();
  const recipients = await resolveRecipients(input);

  const channels: NotificationChannel[] = input.channels ?? [
    ...(settings.telegramEnabled ? (['TELEGRAM'] as const) : []),
    ...(settings.emailEnabled ? (['EMAIL'] as const) : []),
  ];

  const failures: string[] = [];
  let delivered = 0;

  for (const user of recipients) {
    // 1. In-app record, always.
    if (settings.inAppEnabled) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          leadId: input.leadId ?? null,
          event: input.event,
          channel: 'IN_APP',
          status: 'SENT',
          title: input.title,
          body: input.body ?? null,
          payload: (input.payload as Prisma.InputJsonValue) ?? Prisma.DbNull,
          sentAt: new Date(),
        },
      });
      delivered++;
    }

    // 2. External channels, each isolated.
    for (const channel of channels) {
      const provider = providerForChannel(channel);
      if (!provider || !provider.isConfigured()) continue;

      const target = channel === 'TELEGRAM' ? user.telegramChatId : user.email;
      const row = await prisma.notification.create({
        data: {
          userId: user.id,
          leadId: input.leadId ?? null,
          event: input.event,
          channel,
          status: 'PENDING',
          title: input.title,
          body: input.body ?? null,
          payload: (input.payload as Prisma.InputJsonValue) ?? Prisma.DbNull,
        },
      });

      if (!target) {
        await prisma.notification.update({
          where: { id: row.id },
          data: { status: 'SKIPPED', error: `No ${channel.toLowerCase()} address configured for this user` },
        });
        continue;
      }

      try {
        const result = await callProvider(provider, () =>
          provider.send({
            title: input.title,
            body: input.body ?? '',
            target,
            url: input.url ? absoluteUrl(input.url) : undefined,
          }),
        );
        await prisma.notification.update({
          where: { id: row.id },
          data: result.ok
            ? { status: 'SENT', sentAt: new Date() }
            : { status: 'FAILED', error: result.message.slice(0, 500) },
        });
        if (result.ok) delivered++;
        else failures.push(`${channel}: ${result.message}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.notification.update({ where: { id: row.id }, data: { status: 'FAILED', error: message.slice(0, 500) } });
        failures.push(`${channel}: ${message}`);
      }
    }
  }

  return { delivered, failures };
}

function providerForChannel(channel: NotificationChannel): NotificationProvider | null {
  const key = { TELEGRAM: 'telegram', EMAIL: 'email_smtp', IN_APP: 'in_app' }[channel];
  return (findProvider(key) as NotificationProvider | null) ?? null;
}

function absoluteUrl(path: string): string {
  const base = loadEnv().WEB_ORIGIN.replace(/\/$/, '');
  return path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function resolveRecipients(input: NotifyInput): Promise<User[]> {
  if (input.userIds?.length) {
    return prisma.user.findMany({ where: { id: { in: input.userIds }, isActive: true } });
  }

  // Default audiences per event type.
  switch (input.event) {
    case 'HOT_LEAD':
    case 'CAMPAIGN_COMPLETED':
    case 'PROVIDER_FAILURE':
    case 'DAILY_SUMMARY':
      return prisma.user.findMany({ where: { isActive: true, role: { in: ['ADMIN', 'SALES_MANAGER'] } } });
    default:
      return prisma.user.findMany({ where: { isActive: true, role: 'ADMIN' } });
  }
}

/** Notify about a lead that just crossed the hot threshold. */
export async function notifyHotLead(leadId: string): Promise<void> {
  const settings = await getNotificationSettings();
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.isDemo) return;
  if ((lead.leadScore ?? 0) < settings.hotLeadThreshold) return;

  // Avoid re-alerting on every rescore of the same lead.
  const alreadyAlerted = await prisma.notification.findFirst({
    where: { leadId, event: 'HOT_LEAD', createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
  });
  if (alreadyAlerted) return;

  await notify({
    event: 'HOT_LEAD',
    leadId,
    title: `سرنخ داغ: ${lead.businessName}`,
    body: [
      `امتیاز ${lead.leadScore}/۱۰۰`,
      lead.city ? `شهر: ${lead.city}` : null,
      lead.recommendedService ? `خدمت پیشنهادی: ${lead.recommendedService}` : null,
      lead.normalizedPhone ? `تماس: ${lead.normalizedPhone}` : 'شماره تماس نامشخص',
    ]
      .filter(Boolean)
      .join('\n'),
    url: `/leads/${leadId}`,
    userIds: lead.assignedToId ? [lead.assignedToId] : undefined,
  });
}

/** Send reminders for follow-ups that are due, once per follow-up. */
export async function notifyDueFollowUps(): Promise<number> {
  const due = await prisma.followUp.findMany({
    where: { completedAt: null, reminderSentAt: null, dueAt: { lte: new Date() } },
    include: { lead: true, user: true },
    take: 200,
  });

  let sent = 0;
  for (const followUp of due) {
    if (followUp.lead.isDemo) continue;
    await notify({
      event: 'FOLLOW_UP_DUE',
      leadId: followUp.leadId,
      title: `پیگیری سررسید شد: ${followUp.lead.businessName}`,
      body: [followUp.kind, followUp.notes ?? ''].filter(Boolean).join(' — '),
      url: `/leads/${followUp.leadId}`,
      userIds: followUp.userId ? [followUp.userId] : undefined,
    });
    await prisma.followUp.update({ where: { id: followUp.id }, data: { reminderSentAt: new Date() } });
    sent++;
  }
  return sent;
}

/** Daily roll-up for managers. */
export async function sendDailySummary(): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [newLeads, hotLeads, calls, won, overdue] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: since }, isDemo: false } }),
    prisma.lead.count({ where: { leadTemperature: 'HOT', isDemo: false, contactStatus: { in: ['NEW', 'RESEARCHED', 'READY_TO_CALL'] } } }),
    prisma.call.count({ where: { createdAt: { gte: since } } }),
    prisma.lead.count({ where: { wonAt: { gte: since } } }),
    prisma.task.count({ where: { status: 'OPEN', dueAt: { lt: new Date() } } }),
  ]);

  await notify({
    event: 'DAILY_SUMMARY',
    title: 'خلاصه روزانه بایمر',
    body: [
      `سرنخ جدید: ${newLeads}`,
      `سرنخ داغ در انتظار تماس: ${hotLeads}`,
      `تماس‌های ثبت‌شده: ${calls}`,
      `قرارداد بسته‌شده: ${won}`,
      `کارهای عقب‌افتاده: ${overdue}`,
    ].join('\n'),
    url: '/dashboard',
  });
}

/** Escalate a provider outage to the administrators, at most once per hour per provider. */
export async function notifyProviderFailure(providerKey: string, message: string): Promise<void> {
  const recent = await prisma.notification.findFirst({
    where: {
      event: 'PROVIDER_FAILURE',
      title: { contains: providerKey },
      createdAt: { gte: new Date(Date.now() - 3600 * 1000) },
    },
  });
  if (recent) return;

  await notify({
    event: 'PROVIDER_FAILURE',
    title: `خطای سرویس خارجی: ${providerKey}`,
    body: message.slice(0, 500),
    url: '/admin/providers',
  });
}

/** Providers that can currently deliver, for the settings screen. */
export async function availableNotificationChannels(): Promise<NotificationChannel[]> {
  const providers = await activeNotificationProviders();
  const map: Record<string, NotificationChannel> = { telegram: 'TELEGRAM', email_smtp: 'EMAIL', in_app: 'IN_APP' };
  return providers.map((p) => map[p.descriptor.key]).filter(Boolean);
}

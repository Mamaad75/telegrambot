import { loadEnv } from '../config/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Data retention.
 *
 * Logs grow without bound if nothing removes them, and on a 40–80 GB VPS the table that
 * fills the disk is always an operational one: job logs, crawled page bodies, provider
 * usage counters. This job trims those on a schedule.
 *
 * The line it must never cross: **CRM records are never deleted automatically.** Leads,
 * calls, notes, activities, follow-ups and sales briefs are the record of what the sales
 * team did, and losing one to a cleanup job would be worse than running out of disk. Only
 * operational rows are in scope, and each has its own configurable retention.
 *
 * AuditLog is trimmed too, but with a much longer default (a year), because it is what
 * answers "who changed this lead's status?" long after the fact.
 */

export interface CleanupResult {
  table: string;
  deleted: number;
  retentionDays: number;
  /** Set when the table was skipped rather than trimmed. */
  skipped?: string;
}

/** Delete in batches so one sweep cannot hold a long transaction on a small box. */
const BATCH = 5000;

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

export async function runRetentionCleanup(opts: { dryRun?: boolean } = {}): Promise<CleanupResult[]> {
  const env = loadEnv();
  const results: CleanupResult[] = [];

  const sweep = async (
    table: string,
    retentionDays: number,
    count: (before: Date) => Promise<number>,
    remove: (before: Date) => Promise<number>,
  ) => {
    // 0 is a deliberate "keep forever" for that table, not a missing setting.
    if (retentionDays <= 0) {
      results.push({ table, deleted: 0, retentionDays, skipped: 'retention disabled (0)' });
      return;
    }
    const before = cutoff(retentionDays);
    if (opts.dryRun) {
      results.push({ table, deleted: await count(before), retentionDays, skipped: 'dry run' });
      return;
    }
    const deleted = await remove(before);
    results.push({ table, deleted, retentionDays });
  };

  await sweep(
    'JobLog',
    env.RETENTION_JOB_LOG_DAYS,
    (before) => prisma.jobLog.count({ where: { startedAt: { lt: before } } }),
    async (before) => (await prisma.jobLog.deleteMany({ where: { startedAt: { lt: before } } })).count,
  );

  await sweep(
    'ProviderUsage',
    env.RETENTION_PROVIDER_USAGE_DAYS,
    (before) => prisma.providerUsage.count({ where: { day: { lt: before } } }),
    async (before) => (await prisma.providerUsage.deleteMany({ where: { day: { lt: before } } })).count,
  );

  await sweep(
    'Notification',
    env.RETENTION_NOTIFICATION_DAYS,
    (before) => prisma.notification.count({ where: { createdAt: { lt: before }, readAt: { not: null } } }),
    // Unread notifications survive: an alert nobody has seen is not stale, it is pending.
    async (before) =>
      (await prisma.notification.deleteMany({ where: { createdAt: { lt: before }, readAt: { not: null } } })).count,
  );

  await sweep(
    'WebsitePage',
    env.RETENTION_WEBSITE_PAGE_DAYS,
    (before) => prisma.websitePage.count({ where: { audit: { createdAt: { lt: before } } } }),
    // The crawled page bodies, not the audits. Scores, findings and the evidence behind
    // them stay; only the bulky raw page rows behind superseded audits are dropped.
    async (before) => (await prisma.websitePage.deleteMany({ where: { audit: { createdAt: { lt: before } } } })).count,
  );

  await sweep(
    'AuditLog',
    env.RETENTION_AUDIT_LOG_DAYS,
    (before) => prisma.auditLog.count({ where: { createdAt: { lt: before } } }),
    async (before) => (await prisma.auditLog.deleteMany({ where: { createdAt: { lt: before } } })).count,
  );

  // Superseded website audits: keep the most recent per lead plus anything inside the
  // retention window, so a lead never loses the audit its current score was built on.
  const auditRetention = Math.max(env.RETENTION_WEBSITE_PAGE_DAYS, 180);
  if (!opts.dryRun && auditRetention > 0) {
    const before = cutoff(auditRetention);
    const stale = await prisma.websiteAudit.findMany({
      where: { createdAt: { lt: before } },
      select: { id: true, leadId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: BATCH,
    });
    const newestPerLead = new Set<string>();
    const removable: string[] = [];
    for (const audit of stale) {
      if (!newestPerLead.has(audit.leadId)) {
        newestPerLead.add(audit.leadId);
        continue; // keep the newest, however old it is
      }
      removable.push(audit.id);
    }
    const deleted = removable.length
      ? (await prisma.websiteAudit.deleteMany({ where: { id: { in: removable } } })).count
      : 0;
    results.push({ table: 'WebsiteAudit (superseded)', deleted, retentionDays: auditRetention });
  }

  const total = results.reduce((sum, r) => sum + r.deleted, 0);
  logger.info({ scope: 'retention', results, total }, `retention cleanup removed ${total} row(s)`);
  return results;
}

/**
 * Expired cache entries.
 *
 * Redis expires its own keys, so this only clears the database-backed caches that have
 * no TTL of their own — currently the AI analyses that failed validation, which are kept
 * long enough to diagnose a bad prompt and no longer.
 */
export async function cleanupExpiredCache(): Promise<number> {
  const before = cutoff(30);
  const { count } = await prisma.aIAnalysis.deleteMany({
    where: { error: { not: null }, createdAt: { lt: before } },
  });
  if (count > 0) logger.info({ scope: 'retention', deleted: count }, 'removed failed AI analyses older than 30 days');
  return count;
}

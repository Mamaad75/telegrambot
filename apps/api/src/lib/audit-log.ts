import { prisma } from './prisma';

export interface AuditEntry {
  userId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

/**
 * Append-only activity log. Never throws: an audit failure must not roll back the
 * operation the user actually asked for, but it is reported in the process logs.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        actorEmail: entry.actorEmail ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: (entry.before as object) ?? undefined,
        after: (entry.after as object) ?? undefined,
        ip: entry.ip,
        userAgent: entry.userAgent?.slice(0, 500),
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to record entry', entry.action, err);
  }
}

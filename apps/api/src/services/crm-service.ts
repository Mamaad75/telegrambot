import type { ContactStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { recordAudit } from '../lib/audit-log';
import { jobLogger } from '../lib/logger';

/**
 * CRM state changes.
 *
 * One function owns every pipeline transition, because the alternative — each endpoint
 * writing `contactStatus` itself — is how a transition ends up unlogged. That already
 * happened here: logging a call could move a lead from READY_TO_CALL to CONTACTED with
 * nothing recorded anywhere, so the question "who moved this lead, and when?" had no
 * answer for the most common transition in the product.
 *
 * Every transition now writes three things:
 *   1. the lead row itself;
 *   2. a SalesActivity, which is what the salesperson sees on the lead timeline;
 *   3. an AuditLog entry with before/after, which is what an administrator sees.
 */

export interface StatusTransitionInput {
  leadId: string;
  to: ContactStatus;
  actor: { id: string; email: string } | null;
  /** Why it moved: a call outcome, a bulk action, an automatic rule. */
  reasonFa?: string;
  /** Extra fields to write on the lead in the same update. */
  extra?: Prisma.LeadUpdateInput;
  ip?: string;
  /** Source of the change, for the audit trail. */
  source?: 'call' | 'manual' | 'bulk' | 'automation' | 'import';
}

export const CONTACT_STATUS_LABELS_FA: Record<string, string> = {
  NEW: 'جدید',
  READY_TO_CALL: 'آماده تماس',
  CONTACTED: 'تماس گرفته شد',
  INTERESTED: 'علاقه‌مند',
  MEETING_SCHEDULED: 'جلسه تنظیم شد',
  PROPOSAL_SENT: 'پیشنهاد ارسال شد',
  NEGOTIATION: 'در حال مذاکره',
  WON: 'بسته شد — موفق',
  LOST: 'بسته شد — ناموفق',
  NOT_INTERESTED: 'علاقه‌مند نیست',
  UNREACHABLE: 'در دسترس نبود',
  DO_NOT_CONTACT: 'تماس نگیرید',
};

/**
 * Move a lead to a new pipeline stage, recording who did it and why.
 *
 * A no-op transition (same status) still applies `extra` but writes no activity and no
 * audit entry — a timeline full of "CONTACTED → CONTACTED" would bury the real events.
 */
export async function applyStatusTransition(input: StatusTransitionInput): Promise<{ changed: boolean }> {
  const before = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { contactStatus: true, businessName: true },
  });
  if (!before) return { changed: false };

  const changed = before.contactStatus !== input.to;

  await prisma.lead.update({
    where: { id: input.leadId },
    data: {
      ...(input.extra ?? {}),
      ...(changed ? { contactStatus: input.to } : {}),
      // Terminal outcomes stamp their own date, so the reports can measure time-to-close.
      ...(changed && input.to === 'WON' ? { wonAt: new Date() } : {}),
      ...(changed && (input.to === 'LOST' || input.to === 'NOT_INTERESTED') ? { lostAt: new Date() } : {}),
    },
  });

  if (!changed) return { changed: false };

  const fromLabel = CONTACT_STATUS_LABELS_FA[before.contactStatus] ?? before.contactStatus;
  const toLabel = CONTACT_STATUS_LABELS_FA[input.to] ?? input.to;

  await prisma.salesActivity
    .create({
      data: {
        leadId: input.leadId,
        userId: input.actor?.id ?? null,
        type: 'STATUS_CHANGE',
        title: `تغییر وضعیت: ${fromLabel} ← ${toLabel}`,
        body: input.reasonFa ?? null,
        metadata: { from: before.contactStatus, to: input.to, source: input.source ?? 'manual' },
      },
    })
    .catch((err) => {
      jobLogger({ leadId: input.leadId }).warn({ err: String(err) }, 'could not write the status-change activity');
    });

  await recordAudit({
    userId: input.actor?.id ?? null,
    actorEmail: input.actor?.email ?? null,
    action: 'lead.status_changed',
    entityType: 'Lead',
    entityId: input.leadId,
    before: { contactStatus: before.contactStatus },
    after: { contactStatus: input.to, reason: input.reasonFa ?? null, source: input.source ?? 'manual' },
    ip: input.ip,
  });

  return { changed: true };
}

/* -------------------------------------------------------------------------- */
/*  Follow-ups (patch 28)                                                      */
/* -------------------------------------------------------------------------- */

export interface FollowUpBuckets {
  overdue: number;
  today: number;
  upcoming: number;
}

/**
 * Create a follow-up without creating a duplicate.
 *
 * The duplicate problem is real and specific: a salesperson logs a call with "call back
 * Tuesday", then edits the note and saves again, and now Tuesday has two reminders for
 * one lead. An open follow-up for the same lead on the same day is updated rather than
 * added, so the reminder list stays trustworthy.
 */
export async function upsertFollowUp(input: {
  leadId: string;
  userId?: string | null;
  kind: string;
  dueAt: Date;
  notes?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const dayStart = new Date(input.dueAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const existing = await prisma.followUp.findFirst({
    where: { leadId: input.leadId, completedAt: null, dueAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { dueAt: 'asc' },
  });

  if (existing) {
    const updated = await prisma.followUp.update({
      where: { id: existing.id },
      data: {
        dueAt: input.dueAt,
        kind: input.kind,
        notes: input.notes ?? existing.notes,
        userId: input.userId ?? existing.userId,
      },
    });
    await syncNextFollowUp(input.leadId);
    return { id: updated.id, created: false };
  }

  const created = await prisma.followUp.create({
    data: {
      leadId: input.leadId,
      userId: input.userId ?? null,
      kind: input.kind,
      dueAt: input.dueAt,
      notes: input.notes ?? null,
    },
  });
  await syncNextFollowUp(input.leadId);
  return { id: created.id, created: true };
}

/**
 * Keep `Lead.nextFollowUpAt` equal to the earliest open follow-up.
 *
 * The denormalized column is what the lead list and the Today view sort on; letting it
 * drift from the FollowUp rows is how a lead disappears from the queue it belongs in.
 */
export async function syncNextFollowUp(leadId: string): Promise<void> {
  const next = await prisma.followUp.findFirst({
    where: { leadId, completedAt: null },
    orderBy: { dueAt: 'asc' },
  });
  await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } }).catch(() => undefined);
}

/** Follow-ups grouped the way the Today view shows them. */
export async function followUpBuckets(userId?: string | null): Promise<FollowUpBuckets> {
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const scope: Prisma.FollowUpWhereInput = {
    completedAt: null,
    lead: { isArchived: false, isDemo: false },
    ...(userId ? { OR: [{ userId }, { lead: { assignedToId: userId } }] } : {}),
  };

  const [overdue, today, upcoming] = await Promise.all([
    prisma.followUp.count({ where: { ...scope, dueAt: { lt: now } } }),
    prisma.followUp.count({ where: { ...scope, dueAt: { gte: now, lte: todayEnd } } }),
    prisma.followUp.count({ where: { ...scope, dueAt: { gt: todayEnd } } }),
  ]);

  return { overdue, today, upcoming };
}

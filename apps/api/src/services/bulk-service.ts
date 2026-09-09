import type { ContactStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { jobLogger } from '../lib/logger';
import { enqueue } from '../queue/queues';
import { applyStatusTransition, upsertFollowUp } from './crm-service';

/**
 * Bulk actions over many leads.
 *
 * One implementation, called from two places: the HTTP endpoint for small batches, and
 * the worker for large ones. Keeping it in one function is what stops the two paths from
 * drifting — the version that skipped the audit trail on a bulk status change was
 * exactly that kind of drift.
 *
 * The contract is per-lead independence: one lead that fails is counted and stepped
 * over, never a reason to abandon the other four hundred and ninety-nine.
 */

export interface BulkActionPayload {
  leadIds: string[];
  action: 'assign' | 'status' | 'audit' | 'analyze' | 'rescore' | 'follow_up' | 'archive';
  actorId: string;
  actorEmail: string;
  assignedToId?: string | null;
  contactStatus?: string;
  followUpAt?: string;
  followUpKind?: string;
}

export interface BulkActionResult {
  action: string;
  requested: number;
  applied: number;
  failed: number;
}

/**
 * Per-lead delay for the enqueueing actions.
 *
 * A bulk re-audit of two hundred leads would otherwise arrive as two hundred
 * simultaneous crawls. The crawler's per-host throttle protects any single site, but
 * nothing protects the machine or the providers from the burst itself.
 */
const STAGGER_MS: Record<string, number> = { audit: 1500, analyze: 2000, rescore: 250 };

export async function applyBulkAction(payload: BulkActionPayload): Promise<BulkActionResult> {
  const { leadIds, action, actorId, actorEmail } = payload;
  const actor = { id: actorId, email: actorEmail };
  let applied = 0;
  let failed = 0;

  for (const [index, leadId] of leadIds.entries()) {
    try {
      switch (action) {
        case 'assign': {
          const before = await prisma.lead.findUnique({ where: { id: leadId }, select: { assignedToId: true } });
          if (before?.assignedToId === (payload.assignedToId ?? null)) break;
          await prisma.lead.update({ where: { id: leadId }, data: { assignedToId: payload.assignedToId ?? null } });
          await prisma.salesActivity.create({
            data: {
              leadId,
              userId: actorId,
              type: 'ASSIGNMENT',
              title: payload.assignedToId ? 'واگذاری سرنخ (دسته‌ای)' : 'لغو واگذاری سرنخ (دسته‌ای)',
              metadata: { from: before?.assignedToId ?? null, to: payload.assignedToId ?? null, bulk: true },
            },
          });
          break;
        }

        case 'status':
          if (!payload.contactStatus) break;
          // Through the one transition owner, so a bulk change lands on the lead
          // timeline and in the audit log exactly like a single one.
          await applyStatusTransition({
            leadId,
            to: payload.contactStatus as ContactStatus,
            actor,
            reasonFa: 'تغییر وضعیت دسته‌ای',
            source: 'bulk',
          });
          break;

        case 'archive':
          await prisma.lead.update({ where: { id: leadId }, data: { isArchived: true } });
          break;

        case 'follow_up':
          if (!payload.followUpAt) break;
          // Upsert, so running the same bulk follow-up twice does not double every
          // salesperson's reminder list.
          await upsertFollowUp({
            leadId,
            userId: actorId,
            kind: payload.followUpKind ?? 'تماس مجدد',
            dueAt: new Date(payload.followUpAt),
          });
          break;

        case 'audit':
          await enqueue('audit_website', { leadId, chain: {} }, { delay: index * STAGGER_MS.audit });
          break;

        case 'analyze':
          await enqueue('analyze_lead', { leadId }, { delay: index * STAGGER_MS.analyze });
          break;

        case 'rescore':
          await enqueue('calculate_score', { leadId }, { delay: index * STAGGER_MS.rescore });
          break;
      }
      applied++;
    } catch (err) {
      failed++;
      jobLogger({ leadId, jobName: 'bulk_lead_action' }).warn(
        { action, err: err instanceof Error ? err.message : String(err) },
        'bulk action failed for one lead — continuing with the rest',
      );
    }
  }

  return { action, requested: leadIds.length, applied, failed };
}

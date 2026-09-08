import { Worker, type Job } from 'bullmq';
import { loadEnv } from '../config/env';
import { prisma } from '../lib/prisma';
import { createRedisConnection } from '../lib/redis';
import { getAiSettings } from '../lib/settings';
import { analyzeLead } from '../core/ai-analysis';
import { computeMarketSignals } from '../core/market';
import { executeCampaignRun, failRun, recordRunProgress } from '../services/campaign-service';
import { normalizeLead } from '../services/lead-service';
import { notify, notifyHotLead } from '../services/notification-service';
import { recalculateLead, regenerateSalesBrief } from '../services/scoring-service';
import { syncKeywordProviders } from '../services/market-service';
import { auditLeadWebsite, discoverWebsiteForLead } from '../services/website-service';
import { QUEUE, type JobName, type JobPayloads, type QueueName } from './queues';

/**
 * Queue workers.
 *
 * Every job:
 *   * is recorded in JobLog with its outcome, duration and error, so the admin UI shows
 *     what the platform has been doing;
 *   * treats a provider failure as a job failure, letting BullMQ apply the retry policy;
 *   * never throws out of the handler without a recorded reason.
 */

type Handler<N extends JobName> = (payload: JobPayloads[N], job: Job) => Promise<unknown>;

const handlers: { [N in JobName]: Handler<N> } = {
  /* ----------------------------- Campaign ------------------------------- */
  discover_businesses: async ({ campaignId, runId }) => {
    try {
      await executeCampaignRun(campaignId, runId);
      return { campaignId, runId };
    } catch (err) {
      await failRun(runId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  },

  /* ------------------------------ Market -------------------------------- */
  market_analysis: async ({ city, lookbackDays, syncProviders }) => {
    const synced = syncProviders ? await syncKeywordProviders({ city: city ?? undefined }) : null;
    const aggregates = await computeMarketSignals({ city, lookbackDays });
    return {
      synced,
      signals: aggregates.length,
      strong: aggregates.filter((a) => a.strength === 'HIGH' || a.strength === 'VERY_HIGH').length,
    };
  },

  /* ------------------------------- Lead --------------------------------- */
  normalize_lead: async ({ leadId }) => {
    const lead = await normalizeLead(leadId);
    return { leadId, normalized: Boolean(lead) };
  },

  deduplicate_lead: async ({ leadId }) => {
    // Duplicate detection happens at ingestion; this job re-checks a lead after an edit
    // and only reports, so a human decides whether to merge.
    const { findPossibleDuplicates } = await import('../services/lead-service');
    const duplicates = await findPossibleDuplicates(leadId);
    return { leadId, possibleDuplicates: duplicates.map((d) => ({ id: d.lead.id, rule: d.rule })) };
  },

  discover_website: async ({ leadId, force }) => {
    const result = await discoverWebsiteForLead(leadId, { force });
    return { leadId, status: result.status, url: result.url };
  },

  // Crawling and auditing are the same operation for us: the crawl feeds the audit.
  crawl_website: async ({ leadId, force }) => {
    const result = await auditLeadWebsite(leadId, { force });
    return { leadId, auditId: result.audit?.id ?? null, skipped: result.skipped };
  },

  audit_website: async ({ leadId, force }) => {
    const result = await auditLeadWebsite(leadId, { force });
    return { leadId, auditId: result.audit?.id ?? null, skipped: result.skipped };
  },

  calculate_score: async ({ leadId, runId, notifyIfHot }) => {
    const result = await recalculateLead(leadId, { regenerateBrief: true });
    if (!result) return { leadId, scored: false };

    if (notifyIfHot && result.score.temperature === 'HOT') {
      await notifyHotLead(leadId).catch(() => undefined);
    }
    if (runId) await recordRunProgress(runId, leadId).catch(() => undefined);

    return { leadId, score: result.score.score, temperature: result.score.temperature };
  },

  /* --------------------------------- AI ---------------------------------- */
  analyze_lead: async ({ leadId, force }) => {
    const settings = await getAiSettings();
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return { leadId, skipped: 'lead-not-found' };

    // Cost control: cheap deterministic filtering happens before any model call.
    if (!force && (lead.leadScore ?? 0) < settings.minLeadScore) {
      await regenerateSalesBrief(lead);
      return {
        leadId,
        skipped: `Lead score ${lead.leadScore ?? 0} is below the AI threshold (${settings.minLeadScore}); rule-based brief generated instead.`,
      };
    }

    const context = await recalculateLead(leadId, { regenerateBrief: false });
    if (!context) return { leadId, skipped: 'lead-not-found' };

    const services = await prisma.service.findMany({ where: { isActive: true } });
    const marketSignals = await prisma.marketSignal.findMany({
      where: {
        strength: { in: ['MEDIUM', 'HIGH', 'VERY_HIGH'] },
        ...(context.lead.city ? { OR: [{ city: context.lead.city }, { city: null }] } : {}),
      },
      orderBy: { computedAt: 'desc' },
      take: 8,
    });

    const outcome = await analyzeLead(
      {
        lead: context.lead,
        audit: await prisma.websiteAudit.findFirst({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
        signals: context.signals,
        score: context.score,
        businessValue: context.businessValue,
        matches: context.matches,
        services,
        marketContext: marketSignals
          .filter((m) => m.serviceKey)
          .map((m) => ({ serviceKey: m.serviceKey!, strength: m.strength, basis: m.basis })),
      },
      { force },
    );

    // Whatever the AI outcome, the lead always ends up with a usable brief.
    await regenerateSalesBrief(context.lead, {
      signals: context.signals,
      score: context.score,
      businessValue: context.businessValue,
      primary: context.primary,
      secondary: context.secondary,
      services,
    });

    if (outcome.status === 'ok' && !outcome.cached) {
      await notify({
        event: 'AI_ANALYSIS_COMPLETED',
        leadId,
        title: `تحلیل هوش مصنوعی آماده شد: ${context.lead.businessName}`,
        body: outcome.analysis.whyContact ?? 'گزارش فروش به‌روزرسانی شد.',
        url: `/leads/${leadId}`,
        userIds: context.lead.assignedToId ? [context.lead.assignedToId] : undefined,
      }).catch(() => undefined);
    }

    return { leadId, status: outcome.status, ...(outcome.status !== 'ok' ? { reason: outcome.reason } : { cached: outcome.cached }) };
  },

  generate_sales_brief: async ({ leadId }) => {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return { leadId, skipped: 'lead-not-found' };
    await regenerateSalesBrief(lead);
    return { leadId, generated: true };
  },

  /* --------------------------- Notification ------------------------------ */
  send_notification: async (payload) => {
    const result = await notify({
      event: payload.event,
      title: payload.title,
      body: payload.body,
      userIds: payload.userIds,
      leadId: payload.leadId,
      url: payload.url,
    });
    return result;
  },
};

async function process(job: Job): Promise<unknown> {
  const name = job.name as JobName;
  const handler = handlers[name] as Handler<JobName> | undefined;
  if (!handler) throw new Error(`No handler registered for job "${job.name}"`);

  const started = Date.now();
  const log = await prisma.jobLog
    .create({
      data: {
        jobName: name,
        jobId: job.id ?? null,
        queue: job.queueName,
        status: 'RUNNING',
        attempt: job.attemptsMade + 1,
        payload: job.data as object,
      },
    })
    .catch(() => null);

  try {
    const result = await handler(job.data, job);
    if (log) {
      await prisma.jobLog
        .update({
          where: { id: log.id },
          data: {
            status: 'COMPLETED',
            result: (result as object) ?? undefined,
            durationMs: Date.now() - started,
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (log) {
      await prisma.jobLog
        .update({
          where: { id: log.id },
          data: { status: 'FAILED', error: message.slice(0, 2000), durationMs: Date.now() - started, finishedAt: new Date() },
        })
        .catch(() => undefined);
    }
    throw err;
  }
}

/** Concurrency per queue. AI is deliberately serial to keep spend predictable. */
function concurrencyFor(queue: QueueName): number {
  const env = loadEnv();
  switch (queue) {
    case QUEUE.campaign:
      return 1;
    case QUEUE.lead:
      return Math.max(1, env.CRAWLER_CONCURRENCY);
    case QUEUE.ai:
      return 1;
    case QUEUE.notification:
      return 2;
    case QUEUE.market:
      return 1;
    default:
      return env.WORKER_CONCURRENCY;
  }
}

const workers: Worker[] = [];

export function startWorkers(): Worker[] {
  if (workers.length) return workers;
  const env = loadEnv();

  for (const queue of Object.values(QUEUE)) {
    const worker = new Worker(queue, process, {
      connection: createRedisConnection(),
      prefix: env.QUEUE_PREFIX,
      concurrency: concurrencyFor(queue),
      // Give long crawls room to finish before BullMQ considers them stalled.
      lockDuration: 5 * 60_000,
      stalledInterval: 60_000,
    });

    worker.on('failed', (job, err) => {
      // eslint-disable-next-line no-console
      console.error(`[worker:${queue}] job ${job?.name}#${job?.id} failed:`, err?.message);
    });
    worker.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error(`[worker:${queue}] error:`, err.message);
    });

    workers.push(worker);
  }
  return workers;
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
}

import type { Campaign, CampaignRun, Prisma, RunStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { activeLeadSources } from '../providers/registry';
import { discoverBusinesses, type ProviderAttempt } from './discovery-service';
import { enqueue, enqueueLeadPipeline } from '../queue/queues';
import { ingestBusiness } from './lead-service';
import { notify } from './notification-service';

/**
 * Campaign execution.
 *
 * DISCOVERY → NORMALIZATION → DEDUPLICATION happen here, synchronously inside the
 * background job. Everything after that (website discovery, crawl, audit, scoring, AI,
 * sales brief) is enqueued per lead, so one slow website cannot stall the run and a
 * failure on one lead does not lose the others.
 *
 * Progress is tracked in Redis and mirrored onto the CampaignRun row, so the UI can show
 * a live stage and counters.
 */

export interface RunLogEntry {
  at: string;
  stage: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

export async function startCampaignRun(campaignId: string): Promise<CampaignRun> {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });

  const active = await prisma.campaignRun.findFirst({
    where: { campaignId, status: { in: ['QUEUED', 'RUNNING'] } },
  });
  if (active) return active;

  const run = await prisma.campaignRun.create({
    data: { campaignId, status: 'QUEUED', stage: 'QUEUED', log: [] as unknown as Prisma.InputJsonValue },
  });

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'RUNNING', lastRunAt: new Date() } });

  const jobId = await enqueue('discover_businesses', { campaignId, runId: run.id });
  if (!jobId) {
    // No queue available — surface it instead of leaving the run stuck in QUEUED forever.
    await failRun(run.id, 'The job queue is unavailable (Redis). Start the worker and retry.');
    return prisma.campaignRun.findUniqueOrThrow({ where: { id: run.id } });
  }
  return run;
}

export async function executeCampaignRun(campaignId: string, runId: string): Promise<void> {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  await appendLog(runId, 'DISCOVERY', 'شروع اجرای کمپین', 'info');
  await prisma.campaignRun.update({
    where: { id: runId },
    data: { status: 'RUNNING', stage: 'DISCOVERY', startedAt: new Date(), progress: 5 },
  });

  const providers = await activeLeadSources(campaign.providers.length ? campaign.providers : undefined);
  const usable = providers.filter((p) => p.descriptor.key !== 'manual');

  if (!usable.length) {
    await failRun(
      runId,
      'No lead source provider is both enabled and configured. Enable OpenStreetMap in Settings → Integrations, or import leads from CSV.',
    );
    return;
  }

  /* ------------------------------ DISCOVERY ------------------------------ */
  // The provider chain lives in discovery-service: priority order, per-provider
  // failure containment, and a circuit breaker so one broken vendor cannot slow the
  // whole run down. A failure here is recorded and stepped over, never fatal.
  const attempts: ProviderAttempt[] = [];
  const discovery = await discoverBusinesses({
    categories: campaign.categories,
    city: campaign.city,
    province: campaign.province,
    country: campaign.country,
    limit: campaign.maxResults,
    onlyProviders: campaign.providers.length ? campaign.providers : undefined,
    onAttempt: async (attempt) => {
      attempts.push(attempt);
      if (attempt.skipped) {
        await appendLog(runId, 'DISCOVERY', `${attempt.displayName} — «${attempt.category}»: ${attempt.skipReason}`, 'warn');
      } else if (attempt.ok) {
        await appendLog(runId, 'DISCOVERY', `${attempt.displayName} — «${attempt.category}»: ${attempt.found} نتیجه`, 'info');
      } else {
        await appendLog(runId, 'DISCOVERY', `${attempt.displayName} — «${attempt.category}»: ${attempt.error}`, 'warn');
      }
    },
  });

  const collected = discovery.businesses;
  let errors = attempts.filter((a) => !a.ok && !a.skipped).length;

  if (discovery.failedProviders.length > 0 && discovery.successfulProviders.length > 0) {
    await appendLog(
      runId,
      'DISCOVERY',
      `منابع ناموفق: ${discovery.failedProviders.join('، ')} — کمپین با منابع دیگر ادامه یافت.`,
      'warn',
    );
  }

  await prisma.campaignRun.update({
    where: { id: runId },
    data: {
      collected: collected.length,
      errors,
      stage: 'NORMALIZATION',
      progress: 30,
      providerResults: summarizeAttempts(attempts) as unknown as Prisma.InputJsonValue,
    },
  });
  await appendLog(runId, 'NORMALIZATION', `${collected.length} رکورد جمع‌آوری شد؛ شروع نرمال‌سازی و حذف تکراری‌ها`, 'info');

  if (!collected.length) {
    await completeRun(runId, campaign, []);
    return;
  }

  /* ------------------- NORMALIZATION + DEDUPLICATION --------------------- */
  const leadIds: string[] = [];
  let merged = 0;
  let skipped = 0;

  for (const business of collected) {
    try {
      const outcome = await ingestBusiness(business, { campaignId, isDemo: campaign.isDemo });
      if (outcome.action === 'created') leadIds.push(outcome.lead.id);
      else if (outcome.action === 'merged') {
        merged++;
        if (!leadIds.includes(outcome.lead.id)) leadIds.push(outcome.lead.id);
      } else skipped++;
    } catch (err) {
      errors++;
      // One unusable record never costs the rest of the batch.
      await appendLog(runId, 'DEDUPLICATION', `«${business.name}»: ${err instanceof Error ? err.message : err}`, 'warn');
    }
  }

  await prisma.campaignRun.update({
    where: { id: runId },
    data: {
      unique: leadIds.length,
      merged,
      // `duplicates` counts records that were already known; `rejected` is reserved for
      // leads that finished the pipeline and failed the campaign's own filters, so the
      // two are never conflated in the report.
      duplicates: merged + skipped,
      errors,
      stage: 'ENRICHMENT',
      progress: 50,
      log: undefined,
    },
  });
  await appendLog(
    runId,
    'ENRICHMENT',
    `${leadIds.length} سرنخ یکتا (${merged} ادغام، ${skipped} نامناسب). صف‌بندی بررسی وب‌سایت و امتیازدهی.`,
    'info',
  );

  /* --------------------------- ENRICHMENT -------------------------------- */
  await redis.set(`run:${runId}:expected`, String(leadIds.length), 'EX', 60 * 60 * 24);
  await redis.set(`run:${runId}:processed`, '0', 'EX', 60 * 60 * 24);

  if (!leadIds.length) {
    await completeRun(runId, campaign, []);
    return;
  }

  // Stagger the per-lead jobs so the crawler never hammers one host or one provider.
  let index = 0;
  for (const leadId of leadIds) {
    await enqueueLeadPipeline(leadId, {
      runId,
      withAi: campaign.enableAi,
      delayMs: index * 1500,
    });
    index++;
  }
}

/**
 * Called by the scoring job at the end of each lead's pipeline. Updates the run counters
 * and closes the run once every lead has been through.
 */
export async function recordRunProgress(
  runId: string,
  leadId: string,
  outcome: 'processed' | 'failed' = 'processed',
): Promise<void> {
  const run = await prisma.campaignRun.findUnique({ where: { id: runId }, include: { campaign: true } });
  if (!run || isTerminal(run.status)) return;

  // A lead whose pipeline exhausted its retries is still accounted for. Without this
  // the run would sit at 97% forever waiting for a job that is never coming back.
  if (outcome === 'failed') {
    await prisma.campaignRun.update({
      where: { id: runId },
      data: { failed: { increment: 1 }, errors: { increment: 1 } },
    });
    await advanceProgress(runId, run.campaign);
    return;
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    // The lead was deleted mid-run; count it so the run can still finish.
    await advanceProgress(runId, run.campaign);
    return;
  }

  const campaign = run.campaign;
  const score = lead.leadScore ?? 0;
  const passesWebsiteFilter =
    campaign.websiteFilter === 'ANY' ||
    (campaign.websiteFilter === 'NO_WEBSITE' && ['NO_WEBSITE', 'SOCIAL_ONLY'].includes(lead.websiteStatus)) ||
    (campaign.websiteFilter === 'HAS_WEBSITE' && ['ACTIVE', 'NOT_VERIFIED', 'PARKED'].includes(lead.websiteStatus));
  const passesScore = campaign.minLeadScore === null || score >= campaign.minLeadScore;
  const qualified = passesWebsiteFilter && passesScore;

  const data: Prisma.CampaignRunUpdateInput = {};
  if (qualified) data.qualified = { increment: 1 };
  else data.rejected = { increment: 1 };

  if (lead.leadTemperature === 'HOT') data.hot = { increment: 1 };
  else if (lead.leadTemperature === 'WARM') data.warm = { increment: 1 };
  else if (lead.leadTemperature === 'MEDIUM') data.medium = { increment: 1 };
  else data.low = { increment: 1 };

  await prisma.campaignRun.update({ where: { id: runId }, data });
  await advanceProgress(runId, campaign);
}

/** True once a run has reached a state it can never leave. */
function isTerminal(status: RunStatus): boolean {
  return status === 'COMPLETED' || status === 'COMPLETED_WITH_ERRORS' || status === 'FAILED' || status === 'CANCELLED';
}

/**
 * Count one processed lead and close the run when every lead is accounted for.
 *
 * The counter lives in Redis for speed, but Redis is not the source of truth: if the
 * key is gone (restart, eviction, expiry) the count is rebuilt from the database, so a
 * lost key delays the finish by one lead instead of hanging the run forever.
 */
async function advanceProgress(runId: string, campaign: Campaign): Promise<void> {
  let processed = await redis.incr(`run:${runId}:processed`).catch(() => 0);
  let expected = Number((await redis.get(`run:${runId}:expected`).catch(() => null)) ?? 0);

  if (!expected) {
    const run = await prisma.campaignRun.findUnique({ where: { id: runId } });
    expected = run?.unique ?? 0;
    if (run) processed = run.qualified + run.rejected + run.failed;
  }
  if (expected <= 0) return;

  const progress = Math.min(99, 50 + Math.round((processed / expected) * 49));
  await prisma.campaignRun.update({ where: { id: runId }, data: { progress } });

  if (processed >= expected) await completeRun(runId, campaign, []);
}

async function completeRun(runId: string, campaign: Campaign, _leadIds: string[]): Promise<void> {
  const current = await prisma.campaignRun.findUnique({ where: { id: runId } });
  if (!current || isTerminal(current.status)) return;

  // "Finished, but some things went wrong" is a distinct and much more common outcome
  // than either clean success or total failure, and hiding it inside COMPLETED is how
  // a half-empty campaign gets mistaken for a complete one.
  const withErrors = (current.errors ?? 0) > 0 || (current.failed ?? 0) > 0;
  const status: RunStatus = withErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';

  const run = await prisma.campaignRun.update({
    where: { id: runId },
    data: { status, stage: 'READY_TO_CALL', progress: 100, finishedAt: new Date() },
  });

  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'COMPLETED' } });
  await appendLog(
    runId,
    'READY_TO_CALL',
    withErrors
      ? `اجرای کمپین با ${run.errors} خطا و ${run.failed} سرنخ ناموفق کامل شد`
      : 'اجرای کمپین کامل شد',
    withErrors ? 'warn' : 'info',
  );

  await redis.del(`run:${runId}:expected`, `run:${runId}:processed`).catch(() => 0);

  if (!campaign.isDemo) {
    await notify({
      event: 'CAMPAIGN_COMPLETED',
      title: `کمپین «${campaign.name}» کامل شد`,
      body: [
        `جمع‌آوری: ${run.collected}`,
        `یکتا: ${run.unique}`,
        `واجد شرایط: ${run.qualified}`,
        `داغ: ${run.hot} • گرم: ${run.warm} • متوسط: ${run.medium}`,
        run.errors ? `خطا: ${run.errors}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      url: `/campaigns/${campaign.id}`,
    });
  }
}

export async function failRun(runId: string, message: string): Promise<void> {
  await appendLog(runId, 'FAILED', message, 'error');
  const run = await prisma.campaignRun.update({
    where: { id: runId },
    data: { status: 'FAILED', error: message.slice(0, 2000), finishedAt: new Date() },
  });
  await prisma.campaign.update({ where: { id: run.campaignId }, data: { status: 'FAILED' } }).catch(() => undefined);
}

export async function cancelRun(runId: string): Promise<void> {
  const run = await prisma.campaignRun.update({
    where: { id: runId },
    data: { status: 'CANCELLED', finishedAt: new Date() },
  });
  await prisma.campaign.update({ where: { id: run.campaignId }, data: { status: 'CANCELLED' } }).catch(() => undefined);
  await appendLog(runId, 'CANCELLED', 'اجرای کمپین توسط کاربر لغو شد', 'warn');
}

export async function appendLog(runId: string, stage: string, message: string, level: RunLogEntry['level']): Promise<void> {
  try {
    const run = await prisma.campaignRun.findUnique({ where: { id: runId }, select: { log: true } });
    const existing = Array.isArray(run?.log) ? (run!.log as unknown as RunLogEntry[]) : [];
    const entry: RunLogEntry = { at: new Date().toISOString(), stage, message: message.slice(0, 500), level };
    // Keep the log bounded; a long run should not grow a row without limit.
    const next = [...existing, entry].slice(-200);
    await prisma.campaignRun.update({
      where: { id: runId },
      data: { log: next as unknown as Prisma.InputJsonValue, stage },
    });
  } catch {
    /* logging must never break the run */
  }
}


/** Per-provider roll-up stored on the run, so the campaign page can show what worked. */
function summarizeAttempts(attempts: ProviderAttempt[]): Array<{
  providerKey: string;
  displayName: string;
  calls: number;
  ok: number;
  failed: number;
  skipped: number;
  found: number;
  lastError?: string;
}> {
  const byKey = new Map<string, ReturnType<typeof summarizeAttempts>[number]>();
  for (const a of attempts) {
    const entry = byKey.get(a.providerKey) ?? {
      providerKey: a.providerKey,
      displayName: a.displayName,
      calls: 0,
      ok: 0,
      failed: 0,
      skipped: 0,
      found: 0,
    };
    entry.calls++;
    if (a.skipped) entry.skipped++;
    else if (a.ok) entry.ok++;
    else {
      entry.failed++;
      entry.lastError = a.error;
    }
    entry.found += a.found;
    byKey.set(a.providerKey, entry);
  }
  return [...byKey.values()];
}

/**
 * Close runs that stopped making progress.
 *
 * A run must always reach a terminal state. Jobs can be lost in ways no retry policy
 * covers — the worker container is replaced mid-crawl, Redis is flushed, a job is
 * removed by hand — and without this sweep the campaign would stay RUNNING and the
 * salesperson would keep waiting for a list that is never coming.
 *
 * Called from the scheduler. Returns the number of runs it closed.
 */
export async function closeStalledRuns(maxAgeMinutes = 90): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
  const stalled = await prisma.campaignRun.findMany({
    where: { status: { in: ['QUEUED', 'RUNNING'] }, createdAt: { lt: cutoff } },
    include: { campaign: true },
  });

  for (const run of stalled) {
    const accounted = run.qualified + run.rejected + run.failed;
    const missing = Math.max(0, run.unique - accounted);

    await prisma.campaignRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED_WITH_ERRORS',
        stage: 'READY_TO_CALL',
        progress: 100,
        finishedAt: new Date(),
        // Whatever never came back is counted as failed rather than quietly forgotten.
        failed: { increment: missing },
        errors: { increment: missing },
        error: `Run closed automatically after ${maxAgeMinutes} minutes without completing. ${missing} lead(s) never finished their pipeline.`,
      },
    });
    await prisma.campaign
      .update({ where: { id: run.campaignId }, data: { status: 'COMPLETED' } })
      .catch(() => undefined);
    await appendLog(
      run.id,
      'READY_TO_CALL',
      `اجرای کمپین پس از ${maxAgeMinutes} دقیقه بدون پیشرفت بسته شد؛ ${missing} سرنخ ناتمام ماند.`,
      'error',
    );
    await redis.del(`run:${run.id}:expected`, `run:${run.id}:processed`).catch(() => 0);
  }

  return stalled.length;
}

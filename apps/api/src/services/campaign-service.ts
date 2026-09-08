import type { Campaign, CampaignRun, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { activeLeadSources, callProvider } from '../providers/registry';
import type { DiscoveredBusiness, LeadSourceProvider } from '../providers/types';
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
  const categories = campaign.categories.length ? campaign.categories : ['کسب‌وکار'];
  const perCombination = Math.max(5, Math.ceil(campaign.maxResults / (categories.length * usable.length)));

  const collected: DiscoveredBusiness[] = [];
  let errors = 0;

  for (const provider of usable) {
    for (const category of categories) {
      if (collected.length >= campaign.maxResults) break;
      try {
        const found = await callProvider(provider, () =>
          (provider as LeadSourceProvider).discover({
            category,
            city: campaign.city ?? undefined,
            province: campaign.province ?? undefined,
            country: campaign.country,
            limit: Math.min(perCombination, campaign.maxResults - collected.length),
            language: 'fa',
          }),
        );
        collected.push(...found);
        await appendLog(
          runId,
          'DISCOVERY',
          `${provider.descriptor.displayName} — «${category}»: ${found.length} نتیجه`,
          'info',
        );
      } catch (err) {
        errors++;
        const message = err instanceof Error ? err.message : String(err);
        await appendLog(runId, 'DISCOVERY', `${provider.descriptor.displayName} — «${category}»: ${message}`, 'warn');
        // A failing provider does not stop the run; the others continue.
      }
    }
  }

  await prisma.campaignRun.update({
    where: { id: runId },
    data: { collected: collected.length, errors, stage: 'NORMALIZATION', progress: 30 },
  });
  await appendLog(runId, 'NORMALIZATION', `${collected.length} رکورد جمع‌آوری شد؛ شروع نرمال‌سازی و حذف تکراری‌ها`, 'info');

  if (!collected.length) {
    await completeRun(runId, campaign, []);
    return;
  }

  /* ------------------- NORMALIZATION + DEDUPLICATION --------------------- */
  const leadIds: string[] = [];
  let merged = 0;
  let rejected = 0;

  for (const business of collected) {
    try {
      const outcome = await ingestBusiness(business, { campaignId, isDemo: campaign.isDemo });
      if (outcome.action === 'created') leadIds.push(outcome.lead.id);
      else if (outcome.action === 'merged') {
        merged++;
        if (!leadIds.includes(outcome.lead.id)) leadIds.push(outcome.lead.id);
      } else rejected++;
    } catch (err) {
      errors++;
      await appendLog(runId, 'DEDUPLICATION', `«${business.name}»: ${err instanceof Error ? err.message : err}`, 'warn');
    }
  }

  await prisma.campaignRun.update({
    where: { id: runId },
    data: {
      unique: leadIds.length,
      merged,
      rejected,
      errors,
      stage: 'ENRICHMENT',
      progress: 50,
      log: undefined,
    },
  });
  await appendLog(
    runId,
    'ENRICHMENT',
    `${leadIds.length} سرنخ یکتا (${merged} ادغام، ${rejected} رد شده). صف‌بندی بررسی وب‌سایت و امتیازدهی.`,
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
export async function recordRunProgress(runId: string, leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  const run = await prisma.campaignRun.findUnique({ where: { id: runId }, include: { campaign: true } });
  if (!run || run.status === 'COMPLETED' || run.status === 'CANCELLED') return;

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

  const processed = await redis.incr(`run:${runId}:processed`).catch(() => 0);
  const expected = Number((await redis.get(`run:${runId}:expected`).catch(() => '0')) ?? 0);

  if (expected > 0) {
    const progress = Math.min(99, 50 + Math.round((processed / expected) * 49));
    await prisma.campaignRun.update({ where: { id: runId }, data: { progress } });
    if (processed >= expected) {
      await completeRun(runId, campaign, []);
    }
  }
}

async function completeRun(runId: string, campaign: Campaign, _leadIds: string[]): Promise<void> {
  const run = await prisma.campaignRun.update({
    where: { id: runId },
    data: { status: 'COMPLETED', stage: 'READY_TO_CALL', progress: 100, finishedAt: new Date() },
  });

  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'COMPLETED' } });
  await appendLog(runId, 'READY_TO_CALL', 'اجرای کمپین کامل شد', 'info');

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

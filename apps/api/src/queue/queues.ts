import { Queue, type JobsOptions } from 'bullmq';
import { loadEnv } from '../config/env';
import { createRedisConnection } from '../lib/redis';

/**
 * Queue definitions.
 *
 * Work is split across five queues so that expensive, slow or rate-limited work cannot
 * starve the cheap work:
 *
 *   campaign     — long-running discovery runs (one at a time)
 *   lead         — per-lead enrichment: website discovery, crawl, audit, scoring
 *   ai           — model calls, deliberately low concurrency and budget-guarded
 *   notification — outbound messages
 *   market       — keyword/market aggregation
 *
 * Nothing in the HTTP layer ever processes hundreds of records inline; endpoints enqueue
 * and return immediately.
 */

export const QUEUE = {
  campaign: 'campaign',
  lead: 'lead',
  ai: 'ai',
  notification: 'notification',
  market: 'market',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/* -------------------------------------------------------------------------- */
/*  Job payloads                                                               */
/* -------------------------------------------------------------------------- */

/**
 * When present, the job enqueues the next stage of the enrichment pipeline once it has
 * finished. Chaining on completion rather than on a guessed delay is what keeps scoring
 * from running against a crawl that has not finished yet — a real website audit takes
 * tens of seconds, and no fixed delay is right for every site.
 */
export interface PipelineChain {
  withAi?: boolean;
  force?: boolean;
}

export interface JobPayloads {
  discover_businesses: { campaignId: string; runId: string };
  market_analysis: { city?: string | null; lookbackDays?: number; syncProviders?: boolean };

  normalize_lead: { leadId: string };
  deduplicate_lead: { leadId: string };
  discover_website: { leadId: string; force?: boolean; runId?: string; chain?: PipelineChain };
  crawl_website: { leadId: string; force?: boolean; runId?: string; chain?: PipelineChain };
  audit_website: { leadId: string; force?: boolean; runId?: string; chain?: PipelineChain };
  calculate_score: { leadId: string; runId?: string; notifyIfHot?: boolean; chain?: PipelineChain };

  analyze_lead: { leadId: string; force?: boolean; runId?: string };
  generate_sales_brief: { leadId: string; runId?: string };

  send_notification: {
    event: 'HOT_LEAD' | 'LEAD_ASSIGNED' | 'FOLLOW_UP_DUE' | 'CAMPAIGN_COMPLETED' | 'AI_ANALYSIS_COMPLETED' | 'PROVIDER_FAILURE' | 'DAILY_SUMMARY';
    title: string;
    body?: string;
    userIds?: string[];
    leadId?: string;
    url?: string;
  };
}

export type JobName = keyof JobPayloads;

const QUEUE_FOR_JOB: Record<JobName, QueueName> = {
  discover_businesses: QUEUE.campaign,
  market_analysis: QUEUE.market,
  normalize_lead: QUEUE.lead,
  deduplicate_lead: QUEUE.lead,
  discover_website: QUEUE.lead,
  crawl_website: QUEUE.lead,
  audit_website: QUEUE.lead,
  calculate_score: QUEUE.lead,
  analyze_lead: QUEUE.ai,
  generate_sales_brief: QUEUE.ai,
  send_notification: QUEUE.notification,
};

/** Retry policy per job. Network-bound work retries more patiently than pure computation. */
const DEFAULT_OPTIONS: Record<JobName, JobsOptions> = {
  discover_businesses: { attempts: 2, backoff: { type: 'exponential', delay: 10_000 } },
  market_analysis: { attempts: 2, backoff: { type: 'exponential', delay: 15_000 } },
  normalize_lead: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
  deduplicate_lead: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
  discover_website: { attempts: 2, backoff: { type: 'exponential', delay: 20_000 } },
  crawl_website: { attempts: 2, backoff: { type: 'exponential', delay: 20_000 } },
  audit_website: { attempts: 2, backoff: { type: 'exponential', delay: 20_000 } },
  calculate_score: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  analyze_lead: { attempts: 2, backoff: { type: 'exponential', delay: 30_000 } },
  generate_sales_brief: { attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
  send_notification: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: createRedisConnection(),
      prefix: loadEnv().QUEUE_PREFIX,
      defaultJobOptions: {
        removeOnComplete: { age: 3600 * 24, count: 1000 },
        removeOnFail: { age: 3600 * 24 * 7 },
      },
    });
    queues.set(name, queue);
  }
  return queue;
}

export function allQueues(): Queue[] {
  return Object.values(QUEUE).map((n) => getQueue(n));
}

/** Type-safe enqueue. Returns the job id, or null when Redis is unreachable. */
export async function enqueue<N extends JobName>(
  name: N,
  payload: JobPayloads[N],
  options: JobsOptions = {},
): Promise<string | null> {
  try {
    const queue = getQueue(QUEUE_FOR_JOB[name]);
    const job = await queue.add(name, payload, { ...DEFAULT_OPTIONS[name], ...options });
    return job.id ?? null;
  } catch (err) {
    // A queue outage must not take the API down; the caller decides whether to run inline.
    // eslint-disable-next-line no-console
    console.error(`[queue] failed to enqueue ${name}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Start the enrichment pipeline for one lead.
 *
 * Only the first stage is enqueued; each stage enqueues the next when it completes, so a
 * slow crawl can never be overtaken by the scoring job. Each stage is still a separate job
 * with its own retry policy, so a failure in one does not lose the work already done.
 *
 * `delayMs` staggers the *start* of each lead's pipeline, which is what keeps a campaign
 * from hitting one host — or one provider — all at once.
 */
export async function enqueueLeadPipeline(
  leadId: string,
  opts: { runId?: string; withAi?: boolean; force?: boolean; delayMs?: number } = {},
): Promise<void> {
  await enqueue(
    'discover_website',
    { leadId, force: opts.force, runId: opts.runId, chain: { withAi: opts.withAi, force: opts.force } },
    { delay: opts.delayMs ?? 0 },
  );
}

export async function queueHealth(): Promise<Array<{ name: string; waiting: number; active: number; failed: number; delayed: number; completed: number }>> {
  const out = [];
  for (const name of Object.values(QUEUE)) {
    try {
      const q = getQueue(name);
      const counts = await q.getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed');
      out.push({
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
      });
    } catch {
      out.push({ name, waiting: -1, active: -1, failed: -1, delayed: -1, completed: -1 });
    }
  }
  return out;
}

export async function closeQueues(): Promise<void> {
  await Promise.all(Array.from(queues.values()).map((q) => q.close()));
  queues.clear();
}

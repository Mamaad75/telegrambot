import type { ProviderKind } from '@prisma/client';
import { prisma } from './prisma';

export interface UsageIncrement {
  providerKey: string;
  kind: ProviderKind;
  requests?: number;
  failures?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  /**
   * Set when the call was billable but the model has no price in the table.
   *
   * Counted rather than assumed-zero: an unpriced model that runs all month would
   * otherwise keep the estimated spend at $0 and the ceiling would never trip.
   */
  unpriced?: boolean;
  bytesFetched?: number;
}

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Daily rollup of provider consumption. Powers the cost dashboard and the AI budget guard.
 * Failures here are swallowed — accounting must never break the call it is accounting for.
 */
export async function trackUsage(inc: UsageIncrement): Promise<void> {
  const day = startOfUtcDay();
  try {
    const provider = await prisma.provider.findUnique({ where: { key: inc.providerKey }, select: { id: true } });
    await prisma.providerUsage.upsert({
      where: { providerKey_day: { providerKey: inc.providerKey, day } },
      create: {
        providerId: provider?.id,
        providerKey: inc.providerKey,
        kind: inc.kind,
        day,
        requests: inc.requests ?? 0,
        failures: inc.failures ?? 0,
        promptTokens: inc.promptTokens ?? 0,
        completionTokens: inc.completionTokens ?? 0,
        totalTokens: inc.totalTokens ?? 0,
        estimatedCostUsd: inc.estimatedCostUsd ?? 0,
        unpricedRequests: inc.unpriced ? 1 : 0,
        bytesFetched: BigInt(inc.bytesFetched ?? 0),
      },
      update: {
        requests: { increment: inc.requests ?? 0 },
        failures: { increment: inc.failures ?? 0 },
        promptTokens: { increment: inc.promptTokens ?? 0 },
        completionTokens: { increment: inc.completionTokens ?? 0 },
        totalTokens: { increment: inc.totalTokens ?? 0 },
        estimatedCostUsd: { increment: inc.estimatedCostUsd ?? 0 },
        unpricedRequests: { increment: inc.unpriced ? 1 : 0 },
        bytesFetched: { increment: BigInt(inc.bytesFetched ?? 0) },
      },
    });
    if (inc.requests) {
      await prisma.provider.updateMany({ where: { key: inc.providerKey }, data: { lastUsedAt: new Date() } });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[usage] failed to record provider usage', inc.providerKey, err);
  }
}

/**
 * Record a failed provider call and move the provider's health state.
 *
 * The state machine is deliberately gentle at the first failure and firm at the second:
 * one timeout on a slow network is noise, while two consecutive failures mean the
 * integration is genuinely down and the discovery chain should stop preferring it.
 *
 *   HEALTHY / CONFIGURED  --1st failure-->  DEGRADED  --2nd failure-->  ERROR
 *   any state             --any success-->  HEALTHY
 */
export async function recordProviderFailure(providerKey: string, kind: ProviderKind, message: string): Promise<void> {
  await trackUsage({ providerKey, kind, requests: 1, failures: 1 });
  try {
    const row = await prisma.provider.findUnique({ where: { key: providerKey } });
    const failures = (row?.consecutiveFailures ?? 0) + 1;
    await prisma.provider.updateMany({
      where: { key: providerKey },
      data: {
        lastError: message.slice(0, 1000),
        lastErrorAt: new Date(),
        consecutiveFailures: failures,
        state: failures >= 2 ? 'ERROR' : 'DEGRADED',
      },
    });
  } catch {
    /* health bookkeeping must never break the caller's error handling */
  }
}

/** A successful call clears the failure streak and marks the provider healthy. */
export async function recordProviderSuccess(providerKey: string): Promise<void> {
  try {
    await prisma.provider.updateMany({
      where: { key: providerKey },
      data: { state: 'HEALTHY', lastSuccessAt: new Date(), lastUsedAt: new Date(), consecutiveFailures: 0, lastError: null },
    });
  } catch {
    /* ignore */
  }
}

/** Total AI spend for the current calendar month, in USD. */
export async function monthlyAiSpendUsd(): Promise<number> {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await prisma.providerUsage.aggregate({
    where: { kind: 'AI', day: { gte: from } },
    _sum: { estimatedCostUsd: true },
  });
  return rows._sum.estimatedCostUsd ?? 0;
}

/**
 * Where the month's AI spend stands against the ceiling.
 *
 * Reported rather than merely enforced, because "the AI stopped working" is a support
 * ticket while "the AI budget for this month is spent" is an operational fact somebody
 * can act on. The estimate is always labelled as an estimate: provider pricing is
 * configuration, not something we can observe, and a model can change its price without
 * telling us.
 */
export interface AiBudgetStatus {
  /** Estimated, never exact — see docs/PROVIDERS.md § Costs. */
  estimatedSpentUsd: number;
  /**
   * Calls this month whose model has no configured price. The estimate above excludes
   * them, so a non-zero value here means the real spend is higher than the estimate by
   * an unknown amount — which the UI says out loud.
   */
  unpricedCalls: number;
  budgetUsd: number;
  /** True when no further paid model calls will be made this month. */
  exceeded: boolean;
  remainingUsd: number | null;
  percentUsed: number | null;
  /** First day of next month, when the ceiling resets. */
  resetsAt: string;
}

export async function aiBudgetStatus(budgetUsd: number): Promise<AiBudgetStatus> {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [estimatedSpentUsd, unpriced] = await Promise.all([
    monthlyAiSpendUsd(),
    prisma.providerUsage.aggregate({ where: { kind: 'AI', day: { gte: from } }, _sum: { unpricedRequests: true } }),
  ]);
  const unpricedCalls = unpriced._sum.unpricedRequests ?? 0;
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

  if (budgetUsd <= 0) {
    // 0 means "no ceiling", which is a deliberate choice an administrator made.
    return { estimatedSpentUsd, unpricedCalls, budgetUsd, exceeded: false, remainingUsd: null, percentUsed: null, resetsAt };
  }

  return {
    estimatedSpentUsd,
    unpricedCalls,
    budgetUsd,
    exceeded: estimatedSpentUsd >= budgetUsd,
    remainingUsd: Math.max(0, budgetUsd - estimatedSpentUsd),
    percentUsed: Math.min(100, Math.round((estimatedSpentUsd / budgetUsd) * 100)),
    resetsAt,
  };
}

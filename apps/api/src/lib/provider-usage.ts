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
        bytesFetched: BigInt(inc.bytesFetched ?? 0),
      },
      update: {
        requests: { increment: inc.requests ?? 0 },
        failures: { increment: inc.failures ?? 0 },
        promptTokens: { increment: inc.promptTokens ?? 0 },
        completionTokens: { increment: inc.completionTokens ?? 0 },
        totalTokens: { increment: inc.totalTokens ?? 0 },
        estimatedCostUsd: { increment: inc.estimatedCostUsd ?? 0 },
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

export async function recordProviderFailure(providerKey: string, kind: ProviderKind, message: string): Promise<void> {
  await trackUsage({ providerKey, kind, requests: 1, failures: 1 });
  try {
    await prisma.provider.updateMany({
      where: { key: providerKey },
      data: { lastError: message.slice(0, 1000), lastErrorAt: new Date(), state: 'ERROR' },
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

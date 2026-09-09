import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { activeLeadSources, callProvider } from '../providers/registry';
import type { DiscoveredBusiness, DiscoveryQuery, LeadSourceProvider } from '../providers/types';

/**
 * Multi-source lead discovery with priority, fallback and health awareness.
 *
 * The rule is the one the whole platform is built on: **no single vendor may be able to
 * stop a campaign**. Iranian coverage is genuinely patchy — Google Places has the best
 * data but costs money and is not always reachable; OpenStreetMap is free and complete
 * in some cities and thin in others; a search provider finds businesses the other two
 * missed but returns noisier records. So discovery walks a chain rather than trusting one
 * source:
 *
 *     Google Places (if configured)  →  OpenStreetMap / Overpass  →  Search provider
 *                                                                 →  CSV / manual entry
 *
 * A provider that fails is logged, marked, and skipped; the next one runs. A campaign
 * ends with results from whichever sources worked, and the run record says exactly which
 * ones those were — never a silent partial result.
 */

/** Highest first. A configured Google Places gives the best records, so it leads. */
export const LEAD_SOURCE_PRIORITY: Record<string, number> = {
  google_places: 100,
  overpass: 80,
  search_lead_source: 60,
  manual: 10,
};

export interface ProviderAttempt {
  providerKey: string;
  displayName: string;
  category: string;
  ok: boolean;
  found: number;
  durationMs: number;
  error?: string;
  /** True when the provider was skipped without being called. */
  skipped?: boolean;
  skipReason?: string;
}

export interface DiscoveryOutcome {
  businesses: DiscoveredBusiness[];
  attempts: ProviderAttempt[];
  /** Providers that returned at least one record. */
  successfulProviders: string[];
  /** Providers that were tried and failed — the campaign continued without them. */
  failedProviders: string[];
}

/**
 * How many consecutive failures before a provider is skipped for the rest of a run.
 *
 * Two is deliberate: one failure is noise (a timeout, a rate limit), two in a row on
 * different queries means the integration is down, and calling it another forty times
 * only slows the campaign down and fills the log.
 */
const CIRCUIT_BREAK_AFTER = 2;

/**
 * Order the configured lead sources: health first, then priority.
 *
 * A provider in ERROR state still gets a turn — it may have recovered — but it goes
 * last, so a broken paid API does not delay the free source that is working.
 */
export async function orderedLeadSources(onlyKeys?: string[]): Promise<LeadSourceProvider[]> {
  const providers = await activeLeadSources(onlyKeys);
  const rows = await prisma.provider.findMany({
    where: { key: { in: providers.map((p) => p.descriptor.key) } },
    select: { key: true, state: true, priority: true, consecutiveFailures: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return [...providers].sort((a, b) => {
    const ra = byKey.get(a.descriptor.key);
    const rb = byKey.get(b.descriptor.key);
    const healthRank = (state?: string) => (state === 'ERROR' ? 0 : state === 'DEGRADED' ? 1 : 2);
    const health = healthRank(rb?.state) - healthRank(ra?.state);
    if (health !== 0) return health;

    const pa = ra?.priority ?? LEAD_SOURCE_PRIORITY[a.descriptor.key] ?? a.descriptor.priority ?? 50;
    const pb = rb?.priority ?? LEAD_SOURCE_PRIORITY[b.descriptor.key] ?? b.descriptor.priority ?? 50;
    return pb - pa;
  });
}

export interface DiscoverOptions {
  categories: string[];
  city?: string | null;
  province?: string | null;
  country?: string;
  /** Total records wanted across all categories and providers. */
  limit: number;
  language?: string;
  onlyProviders?: string[];
  /** Called after each provider attempt so a run log can be written as it happens. */
  onAttempt?: (attempt: ProviderAttempt) => Promise<void> | void;
  signal?: AbortSignal;
}

/**
 * Run the discovery chain.
 *
 * For each category the providers are tried in order. A provider that returns enough
 * records ends that category early — that is the point of the priority order, and it is
 * what keeps a paid API from being called once a free one already answered. A provider
 * that throws is recorded and the chain continues with the next one.
 */
export async function discoverBusinesses(opts: DiscoverOptions): Promise<DiscoveryOutcome> {
  const providers = await orderedLeadSources(opts.onlyProviders);
  const usable = providers.filter((p) => p.descriptor.key !== 'manual');

  const businesses: DiscoveredBusiness[] = [];
  const attempts: ProviderAttempt[] = [];
  const failureCount = new Map<string, number>();

  if (usable.length === 0) return { businesses, attempts, successfulProviders: [], failedProviders: [] };

  const categories = opts.categories.length ? opts.categories : ['کسب‌وکار'];
  const perCategory = Math.max(1, Math.ceil(opts.limit / categories.length));

  for (const category of categories) {
    if (businesses.length >= opts.limit) break;
    let forThisCategory = 0;

    for (const provider of usable) {
      if (businesses.length >= opts.limit) break;
      if (forThisCategory >= perCategory) break;

      const key = provider.descriptor.key;

      // Circuit breaker: a provider that has failed repeatedly in this run is skipped
      // rather than retried for every remaining category.
      if ((failureCount.get(key) ?? 0) >= CIRCUIT_BREAK_AFTER) {
        const attempt: ProviderAttempt = {
          providerKey: key,
          displayName: provider.descriptor.displayName,
          category,
          ok: false,
          found: 0,
          durationMs: 0,
          skipped: true,
          skipReason: `skipped after ${CIRCUIT_BREAK_AFTER} consecutive failures in this run`,
        };
        attempts.push(attempt);
        await opts.onAttempt?.(attempt);
        continue;
      }

      const query: DiscoveryQuery = {
        category,
        city: opts.city ?? undefined,
        province: opts.province ?? undefined,
        country: opts.country,
        limit: Math.min(perCategory - forThisCategory, opts.limit - businesses.length),
        language: opts.language ?? 'fa',
        signal: opts.signal,
      };

      const started = Date.now();
      try {
        const found = await callProvider(provider, () => provider.discover(query));
        businesses.push(...found);
        forThisCategory += found.length;
        failureCount.set(key, 0);

        const attempt: ProviderAttempt = {
          providerKey: key,
          displayName: provider.descriptor.displayName,
          category,
          ok: true,
          found: found.length,
          durationMs: Date.now() - started,
        };
        attempts.push(attempt);
        await opts.onAttempt?.(attempt);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failureCount.set(key, (failureCount.get(key) ?? 0) + 1);

        const attempt: ProviderAttempt = {
          providerKey: key,
          displayName: provider.descriptor.displayName,
          category,
          ok: false,
          found: 0,
          durationMs: Date.now() - started,
          error: message,
        };
        attempts.push(attempt);
        await opts.onAttempt?.(attempt);

        logger.warn(
          { providerKey: key, category, err: message },
          'lead source failed — continuing with the next provider in the chain',
        );
        // Deliberately no rethrow: the chain exists precisely so that this is survivable.
      }
    }
  }

  const successfulProviders = [...new Set(attempts.filter((a) => a.ok && a.found > 0).map((a) => a.providerKey))];
  const failedProviders = [...new Set(attempts.filter((a) => !a.ok && !a.skipped).map((a) => a.providerKey))];

  return { businesses, attempts, successfulProviders, failedProviders };
}

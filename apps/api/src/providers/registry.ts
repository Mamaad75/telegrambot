import type { Provider as ProviderRow, ProviderKind } from '@prisma/client';
import { loadEnv } from '../config/env';
import { ProviderError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { consumeRateLimit } from '../lib/rate-limiter';
import { recordProviderFailure, trackUsage } from '../lib/provider-usage';
import { GooglePlacesProvider } from './lead-source/google-places';
import { ManualProvider } from './lead-source/manual';
import { OverpassProvider } from './lead-source/overpass';
import { SearchEngineLeadSource } from './lead-source/search-engine';
import { BraveSearchProvider } from './search/brave';
import { GoogleCseProvider } from './search/google-cse';
import { HttpWebsiteProvider } from './website/http-website';
import { AnthropicProvider } from './ai/anthropic';
import { OpenAiCompatibleProvider } from './ai/openai-compatible';
import { GoogleAdsProvider } from './keyword/google-ads';
import { SearchConsoleProvider } from './keyword/search-console';
import { ManualKeywordProvider } from './keyword/manual-keyword';
import { TelegramProvider } from './notification/telegram';
import { EmailProvider } from './notification/email';
import { InAppProvider } from './notification/in-app';
import type {
  AIProvider,
  AnyProvider,
  BaseProvider,
  KeywordInsightProvider,
  LeadSourceProvider,
  NotificationProvider,
  SearchProvider,
  WebsiteProvider,
} from './types';

/**
 * Provider registry.
 *
 * Responsibilities:
 *   1. Instantiate every adapter, configured or not, so the admin UI can list them all.
 *   2. Merge the code-level descriptor with the database row (enabled flag, rate limits).
 *   3. Hand out *only* the adapters that are both enabled and configured.
 *   4. Wrap every call in rate limiting, usage accounting and error containment, so a
 *      failing vendor degrades one capability instead of breaking the request.
 */

let instances: AnyProvider[] | null = null;

/**
 * Additional adapters registered at runtime.
 *
 * Used by the end-to-end tests to inject a deterministic lead source, and available for
 * future adapters that ship outside this file.
 */
let registered: AnyProvider[] = [];

export function registerProvider(provider: AnyProvider): void {
  registered = [...registered.filter((p) => p.descriptor.key !== provider.descriptor.key), provider];
  instances = null;
}

export function unregisterProvider(key: string): void {
  registered = registered.filter((p) => p.descriptor.key !== key);
  instances = null;
}

function buildInstances(): AnyProvider[] {
  const e = loadEnv();

  const brave = new BraveSearchProvider();
  const cse = new GoogleCseProvider();

  /** Pick the highest-priority configured search provider, for adapters that need one. */
  const pickSearch = (): SearchProvider | null => {
    const candidates = [brave, cse].filter((p) => p.isConfigured());
    candidates.sort((a, b) => (b.descriptor.priority ?? 0) - (a.descriptor.priority ?? 0));
    return candidates[0] ?? null;
  };

  return [
    // Lead sources
    new OverpassProvider(),
    new GooglePlacesProvider(),
    new SearchEngineLeadSource(pickSearch),
    new ManualProvider(),

    // Search
    brave,
    cse,

    // Website
    new HttpWebsiteProvider(),

    // AI
    new AnthropicProvider(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL, e.ANTHROPIC_BASE_URL),
    new OpenAiCompatibleProvider({
      key: 'openai',
      displayName: 'OpenAI',
      description: 'OpenAI chat completions API.',
      requiredConfig: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
      cost: 'PAID',
      docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
      baseUrl: e.OPENAI_BASE_URL,
      apiKey: e.OPENAI_API_KEY,
      model: e.OPENAI_MODEL,
      priority: 80,
    }),
    new OpenAiCompatibleProvider({
      key: 'compatible_ai',
      displayName: 'OpenAI-compatible endpoint',
      description: 'Any OpenAI-compatible gateway (OpenRouter, Together, a self-hosted proxy…).',
      requiredConfig: ['COMPATIBLE_AI_BASE_URL', 'COMPATIBLE_AI_MODEL', 'COMPATIBLE_AI_API_KEY'],
      cost: 'PAID',
      baseUrl: e.COMPATIBLE_AI_BASE_URL,
      apiKey: e.COMPATIBLE_AI_API_KEY,
      model: e.COMPATIBLE_AI_MODEL,
      priority: 60,
    }),
    new OpenAiCompatibleProvider({
      key: 'local_ai',
      displayName: 'Local model (Ollama / LM Studio)',
      description: 'A local OpenAI-compatible model server. Free to run, no data leaves the VPS.',
      requiredConfig: ['LOCAL_AI_BASE_URL', 'LOCAL_AI_MODEL'],
      cost: 'FREE',
      docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
      baseUrl: e.LOCAL_AI_BASE_URL,
      apiKey: undefined,
      apiKeyOptional: true,
      model: e.LOCAL_AI_MODEL,
      priority: 40,
    }),

    // Keyword insight
    new GoogleAdsProvider(),
    new SearchConsoleProvider(),
    new ManualKeywordProvider(),

    // Notifications
    new TelegramProvider(),
    new EmailProvider(),
    new InAppProvider(),

    ...registered,
  ];
}

export function allProviders(): AnyProvider[] {
  if (!instances) instances = buildInstances();
  return instances;
}

/** Test helper — forces adapters to be rebuilt from the current environment. */
export function resetProviderRegistry(): void {
  instances = null;
  registered = [];
}

export function findProvider(key: string): AnyProvider | null {
  return allProviders().find((p) => p.descriptor.key === key) ?? null;
}

/**
 * Make sure every adapter has a row in the `Provider` table, and refresh the derived
 * state. Runs at boot; safe to run repeatedly.
 */
export async function syncProviders(): Promise<void> {
  for (const provider of allProviders()) {
    const d = provider.descriptor;
    const configured = provider.isConfigured();
    const existing = await prisma.provider.findUnique({ where: { key: d.key } });

    // Enabling by default only makes sense for adapters that need no credentials.
    const defaultEnabled = d.requiredConfig.length === 0 || configured;
    const enabled = existing?.enabled ?? defaultEnabled;

    const state = !enabled ? 'DISABLED' : configured ? 'CONFIGURED' : 'NOT_CONFIGURED';

    await prisma.provider.upsert({
      where: { key: d.key },
      create: {
        key: d.key,
        kind: d.kind,
        displayName: d.displayName,
        description: d.description,
        enabled,
        state,
        priority: d.priority ?? 50,
        rateLimitPerMinute: d.defaultRateLimit?.perMinute ?? null,
        rateLimitPerHour: d.defaultRateLimit?.perHour ?? null,
        rateLimitPerDay: d.defaultRateLimit?.perDay ?? null,
      },
      update: {
        kind: d.kind,
        displayName: d.displayName,
        description: d.description,
        // Preserve an ERROR state until the next successful call clears it.
        state: existing?.state === 'ERROR' && enabled && configured ? 'ERROR' : state,
        priority: existing?.priority ?? d.priority ?? 50,
      },
    });
  }

  // Keep the LeadSource catalogue in step with the lead-source adapters.
  for (const provider of allProviders().filter((p) => p.descriptor.kind === 'LEAD_SOURCE')) {
    const d = provider.descriptor;
    await prisma.leadSource.upsert({
      where: { key: d.key },
      create: { key: d.key, displayName: d.displayName, kind: 'LEAD_SOURCE', description: d.description },
      update: { displayName: d.displayName, description: d.description },
    });
  }
}

async function providerRows(kind?: ProviderKind): Promise<Map<string, ProviderRow>> {
  const rows = await prisma.provider.findMany({ where: kind ? { kind } : undefined });
  return new Map(rows.map((r) => [r.key, r]));
}

/**
 * Adapters of one kind that are enabled in the database AND fully configured,
 * ordered by effective priority.
 */
export async function activeProviders<T extends BaseProvider>(kind: ProviderKind, onlyKeys?: string[]): Promise<T[]> {
  const rows = await providerRows(kind);
  return allProviders()
    .filter((p): p is AnyProvider & T => {
      if (p.descriptor.kind !== kind) return false;
      if (onlyKeys?.length && !onlyKeys.includes(p.descriptor.key)) return false;
      const row = rows.get(p.descriptor.key);
      if (row && !row.enabled) return false;
      return p.isConfigured();
    })
    .sort((a, b) => {
      const pa = rows.get(a.descriptor.key)?.priority ?? a.descriptor.priority ?? 50;
      const pb = rows.get(b.descriptor.key)?.priority ?? b.descriptor.priority ?? 50;
      return pb - pa;
    }) as unknown as T[];
}

export const activeLeadSources = (keys?: string[]) => activeProviders<LeadSourceProvider>('LEAD_SOURCE', keys);
export const activeSearchProviders = () => activeProviders<SearchProvider>('SEARCH');
export const activeKeywordProviders = () => activeProviders<KeywordInsightProvider>('KEYWORD_INSIGHT');
export const activeNotificationProviders = () => activeProviders<NotificationProvider>('NOTIFICATION');

/** The website crawler is built in and always present. */
export function websiteProvider(): WebsiteProvider {
  return findProvider('website_crawler') as unknown as WebsiteProvider;
}

/**
 * The AI provider selected in Settings → AI (falling back to AI_PROVIDER in the
 * environment). Returns null when AI is switched off or not configured — every caller
 * must handle that, because AI is an enhancement, never a requirement.
 */
export async function selectedAiProvider(preferredKey?: string): Promise<AIProvider | null> {
  const keyMap: Record<string, string> = {
    anthropic: 'anthropic',
    openai: 'openai',
    compatible: 'compatible_ai',
    local: 'local_ai',
  };
  const settingKey = preferredKey ?? keyMap[loadEnv().AI_PROVIDER] ?? null;
  if (!settingKey) return null;

  const provider = findProvider(settingKey) as AIProvider | null;
  if (!provider || provider.descriptor.kind !== 'AI') return null;
  if (!provider.isConfigured()) return null;

  const row = await prisma.provider.findUnique({ where: { key: settingKey } });
  if (row && !row.enabled) return null;
  return provider;
}

/* -------------------------------------------------------------------------- */
/*  Guarded execution                                                          */
/* -------------------------------------------------------------------------- */

export interface CallOptions {
  /** Extra usage metrics to record alongside the request count. */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; estimatedCostUsd?: number; bytesFetched?: number };
}

/**
 * Run a provider call with rate limiting, usage accounting and error capture.
 *
 * Throws ProviderError on failure so the caller can decide: fall back to another adapter,
 * or continue without the data. It never swallows the error silently, and it always
 * records the failure so Settings → Integrations shows what went wrong.
 */
export async function callProvider<T>(
  provider: BaseProvider,
  fn: () => Promise<T>,
  opts: CallOptions = {},
): Promise<T> {
  const d = provider.descriptor;
  const row = await prisma.provider.findUnique({ where: { key: d.key } }).catch(() => null);

  const limits = {
    perMinute: row?.rateLimitPerMinute ?? d.defaultRateLimit?.perMinute ?? null,
    perHour: row?.rateLimitPerHour ?? d.defaultRateLimit?.perHour ?? null,
    perDay: row?.rateLimitPerDay ?? d.defaultRateLimit?.perDay ?? null,
  };

  const decision = await consumeRateLimit(d.key, limits);
  if (!decision.allowed) {
    const message = `Rate limit reached for ${d.displayName}: ${decision.used}/${decision.limit} per ${decision.window}. Retry in ${decision.retryAfterSeconds}s.`;
    await recordProviderFailure(d.key, d.kind, message);
    throw new ProviderError(d.key, message, { retryable: true, statusCode: 429 });
  }

  try {
    const result = await fn();
    await trackUsage({ providerKey: d.key, kind: d.kind, requests: 1, ...opts.usage });
    // A successful call clears a stale ERROR state.
    if (row?.state === 'ERROR') {
      await prisma.provider
        .update({ where: { key: d.key }, data: { state: 'CONFIGURED', lastError: null } })
        .catch(() => undefined);
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordProviderFailure(d.key, d.kind, message);
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(d.key, message, { retryable: true });
  }
}

/**
 * Try each provider in turn and return the first success.
 * Used wherever a capability has several interchangeable vendors.
 */
export async function firstSuccessful<P extends BaseProvider, T>(
  providers: P[],
  fn: (p: P) => Promise<T>,
  isAcceptable: (result: T) => boolean = () => true,
): Promise<{ result: T; provider: P } | { result: null; errors: Array<{ provider: string; message: string }> }> {
  const errors: Array<{ provider: string; message: string }> = [];
  for (const provider of providers) {
    try {
      const result = await callProvider(provider, () => fn(provider));
      if (isAcceptable(result)) return { result, provider };
    } catch (err) {
      errors.push({ provider: provider.descriptor.key, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { result: null, errors };
}

import { loadEnv } from '../../config/env';
import { ProviderError } from '../../lib/errors';
import { httpJson } from '../../lib/http';
import type { ProviderDescriptor, SearchProvider, SearchResult } from '../types';

/**
 * Brave Search API adapter. Optional; used mainly for website discovery.
 * Free tier available, so it is the recommended first search provider.
 */

interface BraveResponse {
  web?: { results?: Array<{ title: string; url: string; description?: string }> };
}

export class BraveSearchProvider implements SearchProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'brave_search',
    kind: 'SEARCH',
    displayName: 'Brave Search API',
    description: 'Official Brave Search API. Used to discover a business website from its name and city.',
    requiredConfig: ['BRAVE_SEARCH_API_KEY'],
    cost: 'FREEMIUM',
    docsUrl: 'https://brave.com/search/api/',
    defaultRateLimit: { perMinute: 20, perHour: 300, perDay: 1800 },
    priority: 80,
  };

  isConfigured(): boolean {
    return Boolean(loadEnv().BRAVE_SEARCH_API_KEY);
  }

  missingConfig(): string[] {
    return this.isConfigured() ? [] : ['BRAVE_SEARCH_API_KEY'];
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: 'BRAVE_SEARCH_API_KEY is not set' };
    try {
      const results = await this.search('baimar', { count: 1 });
      return { ok: true, message: `Brave Search reachable (${results.length} results)` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unreachable' };
    }
  }

  async search(
    query: string,
    opts: { count?: number; country?: string; language?: string; signal?: AbortSignal } = {},
  ): Promise<SearchResult[]> {
    const key = loadEnv().BRAVE_SEARCH_API_KEY;
    if (!key) throw new ProviderError(this.descriptor.key, 'BRAVE_SEARCH_API_KEY is not configured');

    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(opts.count ?? 10, 20)),
      country: (opts.country ?? 'ir').toLowerCase(),
      search_lang: opts.language ?? 'fa',
      safesearch: 'moderate',
    });

    const { data } = await httpJson<BraveResponse>(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { 'X-Subscription-Token': key, accept: 'application/json' },
      timeoutMs: 15000,
      retries: 1,
      providerKey: this.descriptor.key,
      signal: opts.signal,
    });

    return (data.web?.results ?? []).map((r, i) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      rank: i + 1,
    }));
  }
}

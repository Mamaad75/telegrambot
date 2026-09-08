import { loadEnv } from '../../config/env';
import { ProviderError } from '../../lib/errors';
import { httpJson } from '../../lib/http';
import type { ProviderDescriptor, SearchProvider, SearchResult } from '../types';

/**
 * Google Programmable Search (Custom Search JSON API) adapter.
 * Official API, 100 queries/day free, billed above that.
 */

interface CseResponse {
  items?: Array<{ title: string; link: string; snippet?: string }>;
}

export class GoogleCseProvider implements SearchProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'google_cse',
    kind: 'SEARCH',
    displayName: 'Google Programmable Search',
    description: 'Official Google Custom Search JSON API. 100 free queries per day, billed beyond that.',
    requiredConfig: ['GOOGLE_CSE_API_KEY', 'GOOGLE_CSE_ID'],
    cost: 'FREEMIUM',
    docsUrl: 'https://developers.google.com/custom-search/v1/overview',
    defaultRateLimit: { perMinute: 10, perHour: 100, perDay: 100 },
    priority: 70,
  };

  isConfigured(): boolean {
    const e = loadEnv();
    return Boolean(e.GOOGLE_CSE_API_KEY && e.GOOGLE_CSE_ID);
  }

  missingConfig(): string[] {
    const e = loadEnv();
    const missing: string[] = [];
    if (!e.GOOGLE_CSE_API_KEY) missing.push('GOOGLE_CSE_API_KEY');
    if (!e.GOOGLE_CSE_ID) missing.push('GOOGLE_CSE_ID');
    return missing;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: `Missing: ${this.missingConfig().join(', ')}` };
    try {
      const results = await this.search('baimar', { count: 1 });
      return { ok: true, message: `Custom Search reachable (${results.length} results)` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unreachable' };
    }
  }

  async search(
    query: string,
    opts: { count?: number; country?: string; language?: string; signal?: AbortSignal } = {},
  ): Promise<SearchResult[]> {
    const e = loadEnv();
    if (!this.isConfigured()) {
      throw new ProviderError(this.descriptor.key, `Missing configuration: ${this.missingConfig().join(', ')}`);
    }
    const params = new URLSearchParams({
      key: e.GOOGLE_CSE_API_KEY!,
      cx: e.GOOGLE_CSE_ID!,
      q: query,
      num: String(Math.min(opts.count ?? 10, 10)),
      gl: (opts.country ?? 'ir').toLowerCase(),
      hl: opts.language ?? 'fa',
    });

    const { data } = await httpJson<CseResponse>(`https://www.googleapis.com/customsearch/v1?${params}`, {
      timeoutMs: 15000,
      retries: 1,
      providerKey: this.descriptor.key,
      signal: opts.signal,
    });

    return (data.items ?? []).map((r, i) => ({ title: r.title, url: r.link, snippet: r.snippet, rank: i + 1 }));
  }
}

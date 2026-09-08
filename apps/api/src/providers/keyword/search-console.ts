import { loadEnv } from '../../config/env';
import { ProviderError } from '../../lib/errors';
import { httpJson } from '../../lib/http';
import type { KeywordInsightProvider, KeywordObservation, KeywordQuery, ProviderDescriptor } from '../types';
import { getGoogleAccessToken } from './google-oauth';

/**
 * Google Search Console adapter — FIRST-PARTY data for Baimar-owned properties only.
 *
 * Search Console reports the queries that led people to *Baimar's own* website, with
 * clicks, impressions, CTR and average position, aggregated by Google. It cannot and does
 * not expose who searched. The platform labels this data FIRST_PARTY_BAIMAR so a
 * salesperson never confuses it with a signal about the lead's own market.
 */

interface SearchAnalyticsResponse {
  rows?: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
}

export class SearchConsoleProvider implements KeywordInsightProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'search_console',
    kind: 'KEYWORD_INSIGHT',
    displayName: 'Google Search Console',
    description:
      "First-party search data for Baimar's own verified properties: which queries bring visitors to baimar.ir. Aggregated by Google; no individual user data.",
    requiredConfig: ['GSC_CLIENT_ID', 'GSC_CLIENT_SECRET', 'GSC_REFRESH_TOKEN', 'GSC_SITE_URL'],
    cost: 'FREE',
    docsUrl: 'https://developers.google.com/webmaster-tools/v1/searchanalytics/query',
    defaultRateLimit: { perMinute: 10, perHour: 200, perDay: 1000 },
    priority: 80,
  };

  isConfigured(): boolean {
    return this.missingConfig().length === 0;
  }

  missingConfig(): string[] {
    const e = loadEnv();
    const values: Record<string, string | undefined> = {
      GSC_CLIENT_ID: e.GSC_CLIENT_ID,
      GSC_CLIENT_SECRET: e.GSC_CLIENT_SECRET,
      GSC_REFRESH_TOKEN: e.GSC_REFRESH_TOKEN,
      GSC_SITE_URL: e.GSC_SITE_URL,
    };
    return Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: `Missing: ${this.missingConfig().join(', ')}` };
    try {
      const rows = await this.fetchKeywordData({ limit: 1 });
      return { ok: true, message: `Search Console reachable (${rows.length} sample row)` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unreachable' };
    }
  }

  async fetchKeywordData(q: KeywordQuery = {}): Promise<KeywordObservation[]> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.descriptor.key, `Missing configuration: ${this.missingConfig().join(', ')}`);
    }
    const e = loadEnv();
    const to = q.to ?? new Date(Date.now() - 2 * 24 * 3600 * 1000); // GSC data lags ~2 days
    const from = q.from ?? new Date(to.getTime() - 90 * 24 * 3600 * 1000);
    const siteUrl = encodeURIComponent(e.GSC_SITE_URL!);

    const { data } = await httpJson<SearchAnalyticsResponse>(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await getGoogleAccessToken(
            this.descriptor.key,
            e.GSC_CLIENT_ID!,
            e.GSC_CLIENT_SECRET!,
            e.GSC_REFRESH_TOKEN!,
          )}`,
        },
        body: JSON.stringify({
          startDate: iso(from),
          endDate: iso(to),
          dimensions: ['query'],
          rowLimit: Math.min(q.limit ?? 500, 25000),
          dataState: 'final',
        }),
        timeoutMs: 60_000,
        retries: 1,
        maxBytes: 20_000_000,
        providerKey: this.descriptor.key,
        signal: q.signal,
      },
    );

    return (data.rows ?? [])
      .filter((r) => r.keys?.[0])
      .map<KeywordObservation>((r) => ({
        keyword: r.keys![0],
        source: 'SEARCH_CONSOLE',
        origin: 'FIRST_PARTY_BAIMAR',
        sourceUrl: e.GSC_SITE_URL,
        language: 'fa',
        country: q.country ?? 'IR',
        city: q.city,
        province: q.province,
        // Search Console never reports absolute search volume — leaving it undefined is
        // what stops the dashboard from inventing one.
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        averagePosition: r.position,
        periodStart: from,
        periodEnd: to,
      }));
  }
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

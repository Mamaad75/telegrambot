import { loadEnv } from '../../config/env';
import { ProviderError } from '../../lib/errors';
import { httpJson } from '../../lib/http';
import type {
  KeywordInsightProvider,
  KeywordObservation,
  KeywordQuery,
  ProviderDescriptor,
  SearchTermObservation,
} from '../types';
import { getGoogleAccessToken } from './google-oauth';

/**
 * Google Ads adapter — advertising data for Baimar's OWN account only.
 *
 * What this reads: the search terms that triggered Baimar's ads, with their clicks,
 * impressions, conversions and cost, plus aggregate keyword planning data.
 *
 * What this deliberately does NOT do: identify who searched. The Google Ads API exposes
 * aggregate campaign performance, never individual users, and the platform presents it
 * as a market demand signal rather than as a person.
 */

interface SearchStreamRow {
  searchTermView?: { searchTerm?: string };
  segments?: { date?: string; keyword?: { info?: { matchType?: string; text?: string } } };
  campaign?: { name?: string };
  adGroup?: { name?: string };
  metrics?: {
    clicks?: string;
    impressions?: string;
    conversions?: number;
    costMicros?: string;
    ctr?: number;
    averageCpc?: string;
  };
}

interface SearchStreamChunk {
  results?: SearchStreamRow[];
}

interface KeywordIdeaResult {
  text?: string;
  keywordIdeaMetrics?: {
    avgMonthlySearches?: string;
    competition?: string;
    competitionIndex?: string;
    monthlySearchVolumes?: Array<{ year?: string; month?: string; monthlySearches?: string }>;
  };
}

interface GenerateKeywordIdeasResponse {
  results?: KeywordIdeaResult[];
}

export class GoogleAdsProvider implements KeywordInsightProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'google_ads',
    kind: 'KEYWORD_INSIGHT',
    displayName: 'Google Ads',
    description:
      "Reads advertising performance and keyword planning data for Baimar's own Google Ads account. Aggregate data only — never individual user activity.",
    requiredConfig: [
      'GOOGLE_ADS_DEVELOPER_TOKEN',
      'GOOGLE_ADS_CLIENT_ID',
      'GOOGLE_ADS_CLIENT_SECRET',
      'GOOGLE_ADS_REFRESH_TOKEN',
      'GOOGLE_ADS_CUSTOMER_ID',
    ],
    cost: 'FREE',
    docsUrl: 'https://developers.google.com/google-ads/api/docs/start',
    defaultRateLimit: { perMinute: 10, perHour: 200, perDay: 1000 },
    priority: 90,
  };

  isConfigured(): boolean {
    return this.missingConfig().length === 0;
  }

  missingConfig(): string[] {
    const e = loadEnv();
    const values: Record<string, string | undefined> = {
      GOOGLE_ADS_DEVELOPER_TOKEN: e.GOOGLE_ADS_DEVELOPER_TOKEN,
      GOOGLE_ADS_CLIENT_ID: e.GOOGLE_ADS_CLIENT_ID,
      GOOGLE_ADS_CLIENT_SECRET: e.GOOGLE_ADS_CLIENT_SECRET,
      GOOGLE_ADS_REFRESH_TOKEN: e.GOOGLE_ADS_REFRESH_TOKEN,
      GOOGLE_ADS_CUSTOMER_ID: e.GOOGLE_ADS_CUSTOMER_ID,
    };
    return Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: `Missing: ${this.missingConfig().join(', ')}` };
    try {
      const rows = await this.query('SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1');
      return { ok: true, message: `Google Ads reachable (${rows.length} customer row)` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unreachable' };
    }
  }

  /** Search terms that triggered Baimar's ads. Advertising data, clearly labelled as such. */
  async fetchSearchTerms(q: KeywordQuery = {}): Promise<SearchTermObservation[]> {
    this.assertConfigured();
    const { from, to } = this.dateRange(q);
    const limit = Math.min(q.limit ?? 500, 5000);

    const gaql = `
      SELECT
        search_term_view.search_term,
        campaign.name,
        ad_group.name,
        segments.date,
        segments.keyword.info.match_type,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc
      FROM search_term_view
      WHERE segments.date BETWEEN '${from}' AND '${to}'
      ORDER BY metrics.impressions DESC
      LIMIT ${limit}
    `;

    const rows = await this.query(gaql, q.signal);
    return rows
      .filter((r) => r.searchTermView?.searchTerm)
      .map<SearchTermObservation>((r) => ({
        term: r.searchTermView!.searchTerm!,
        keyword: r.searchTermView!.searchTerm!,
        source: 'GOOGLE_ADS',
        origin: 'ADVERTISING_CAMPAIGN',
        campaignName: r.campaign?.name,
        adGroupName: r.adGroup?.name,
        matchType: r.segments?.keyword?.info?.matchType,
        city: q.city,
        province: q.province,
        country: q.country ?? 'IR',
        clicks: toInt(r.metrics?.clicks),
        impressions: toInt(r.metrics?.impressions),
        conversions: r.metrics?.conversions,
        costMicros: toInt(r.metrics?.costMicros),
        ctr: r.metrics?.ctr,
        averageCpcMicros: toInt(r.metrics?.averageCpc),
        date: r.segments?.date ? new Date(`${r.segments.date}T00:00:00Z`) : undefined,
        periodStart: new Date(`${from}T00:00:00Z`),
        periodEnd: new Date(`${to}T00:00:00Z`),
      }));
  }

  /** Aggregate keyword demand from the Keyword Planner service. */
  async fetchKeywordData(q: KeywordQuery = {}): Promise<KeywordObservation[]> {
    this.assertConfigured();
    if (!q.keywords?.length) return [];

    const e = loadEnv();
    const customerId = e.GOOGLE_ADS_CUSTOMER_ID!.replace(/-/g, '');
    const url = `https://googleads.googleapis.com/${e.GOOGLE_ADS_API_VERSION}/customers/${customerId}:generateKeywordIdeas`;

    const { data } = await httpJson<GenerateKeywordIdeasResponse>(url, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        keywordSeed: { keywords: q.keywords.slice(0, 20) },
        language: 'languageConstants/1064', // Persian
        geoTargetConstants: ['geoTargetConstants/2364'], // Iran
        includeAdultKeywords: false,
      }),
      timeoutMs: 60_000,
      retries: 1,
      providerKey: this.descriptor.key,
      signal: q.signal,
    });

    const { from, to } = this.dateRange(q);
    return (data.results ?? [])
      .filter((r) => r.text)
      .map<KeywordObservation>((r) => ({
        keyword: r.text!,
        source: 'GOOGLE_ADS',
        origin: 'AGGREGATE_SEARCH_SIGNAL',
        language: 'fa',
        city: q.city,
        province: q.province,
        country: q.country ?? 'IR',
        searchVolume: toInt(r.keywordIdeaMetrics?.avgMonthlySearches),
        competition: r.keywordIdeaMetrics?.competition,
        competitionIndex: toInt(r.keywordIdeaMetrics?.competitionIndex),
        trend: trendFrom(r.keywordIdeaMetrics?.monthlySearchVolumes),
        periodStart: new Date(`${from}T00:00:00Z`),
        periodEnd: new Date(`${to}T00:00:00Z`),
      }));
  }

  /* ----------------------------------------------------------------------- */

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ProviderError(this.descriptor.key, `Missing configuration: ${this.missingConfig().join(', ')}`);
    }
  }

  private async headers(): Promise<Record<string, string>> {
    const e = loadEnv();
    const token = await getGoogleAccessToken(
      this.descriptor.key,
      e.GOOGLE_ADS_CLIENT_ID!,
      e.GOOGLE_ADS_CLIENT_SECRET!,
      e.GOOGLE_ADS_REFRESH_TOKEN!,
    );
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'developer-token': e.GOOGLE_ADS_DEVELOPER_TOKEN!,
    };
    if (e.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
      headers['login-customer-id'] = e.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, '');
    }
    return headers;
  }

  private async query(gaql: string, signal?: AbortSignal): Promise<SearchStreamRow[]> {
    const e = loadEnv();
    const customerId = e.GOOGLE_ADS_CUSTOMER_ID!.replace(/-/g, '');
    const url = `https://googleads.googleapis.com/${e.GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;

    // searchStream returns a JSON array of chunks, each holding a `results` page.
    const { data } = await httpJson<SearchStreamChunk[] | SearchStreamChunk>(url, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ query: gaql }),
      timeoutMs: 90_000,
      retries: 1,
      maxBytes: 20_000_000,
      providerKey: this.descriptor.key,
      signal,
    });

    const chunks = Array.isArray(data) ? data : [data];
    return chunks.flatMap((c) => c.results ?? []);
  }

  private dateRange(q: KeywordQuery): { from: string; to: string } {
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    return { from: iso(from), to: iso(to) };
  }
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toInt(v: string | number | undefined | null): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Compare the first and last months of the volume series to describe the direction. */
function trendFrom(series?: Array<{ monthlySearches?: string }>): string | undefined {
  if (!series || series.length < 2) return undefined;
  const first = toInt(series[0]?.monthlySearches);
  const last = toInt(series[series.length - 1]?.monthlySearches);
  if (first === undefined || last === undefined || first === 0) return undefined;
  const change = ((last - first) / first) * 100;
  if (change > 15) return 'RISING';
  if (change < -15) return 'FALLING';
  return 'STABLE';
}

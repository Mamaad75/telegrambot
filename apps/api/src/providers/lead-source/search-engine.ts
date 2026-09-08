import { extractDomain } from '@baimar/shared';
import type { DiscoveredBusiness, DiscoveryQuery, LeadSourceProvider, ProviderDescriptor, SearchProvider } from '../types';
import { ProviderError } from '../../lib/errors';

/**
 * Lead discovery through a web search provider.
 *
 * Complements the map-based sources: a search for "کلینیک زیبایی اراک" surfaces
 * businesses that have a website but no map listing. What we learn here is limited —
 * a name and a URL — so every other field is deliberately left undefined and filled in
 * later by the crawler and the enrichment stage.
 *
 * It is a thin composition over whichever SearchProvider is configured; if none is,
 * the adapter reports itself as not configured and discovery skips it.
 */

const DIRECTORY_DOMAINS = new Set([
  'instagram.com',
  'facebook.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  't.me',
  'telegram.me',
  'youtube.com',
  'aparat.com',
  'wikipedia.org',
  'google.com',
  'maps.google.com',
  'yelp.com',
  'tripadvisor.com',
  'divar.ir',
  'sheypoor.com',
  'digikala.com',
  'eitaa.com',
  'balad.ir',
  'neshan.org',
]);

export class SearchEngineLeadSource implements LeadSourceProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'search_engine',
    kind: 'LEAD_SOURCE',
    displayName: 'Web search discovery',
    description:
      'Finds businesses that have a website through the configured search provider. Yields a name and a URL only; the rest is filled in by the crawler.',
    requiredConfig: ['a configured SEARCH provider'],
    cost: 'FREEMIUM',
    priority: 40,
  };

  constructor(private readonly getSearchProvider: () => SearchProvider | null) {}

  isConfigured(): boolean {
    return this.getSearchProvider() !== null;
  }

  missingConfig(): string[] {
    return this.isConfigured() ? [] : ['BRAVE_SEARCH_API_KEY or GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID'];
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    const sp = this.getSearchProvider();
    if (!sp) return { ok: false, message: 'No search provider is configured' };
    return sp.healthCheck ? sp.healthCheck() : { ok: true, message: `Using ${sp.descriptor.displayName}` };
  }

  async discover(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    const search = this.getSearchProvider();
    if (!search) throw new ProviderError(this.descriptor.key, 'No search provider is configured');

    const location = [query.city, query.province].filter(Boolean).join(' ');
    const terms = [`${query.category} ${location}`.trim(), `${query.category} ${location} تماس`.trim()];

    const seenDomains = new Set<string>();
    const out: DiscoveredBusiness[] = [];

    for (const term of terms) {
      if (out.length >= query.limit) break;
      const results = await search.search(term, {
        count: Math.min(20, query.limit),
        country: query.country ?? 'ir',
        language: query.language ?? 'fa',
        signal: query.signal,
      });

      for (const r of results) {
        const domain = extractDomain(r.url);
        if (!domain) continue;
        // Aggregators and social platforms are not businesses in their own right.
        if (DIRECTORY_DOMAINS.has(domain) || [...DIRECTORY_DOMAINS].some((d) => domain.endsWith(`.${d}`))) continue;
        if (seenDomains.has(domain)) continue;
        seenDomains.add(domain);

        out.push({
          providerKey: this.descriptor.key,
          externalId: domain,
          sourceUrl: r.url,
          origin: 'PUBLIC_BUSINESS_RESEARCH',
          name: this.cleanTitle(r.title),
          category: query.category,
          city: query.city,
          province: query.province,
          country: query.country ?? 'IR',
          website: `https://${domain}`,
          description: r.snippet,
          raw: { title: r.title, url: r.url, snippet: r.snippet, provider: search.descriptor.key },
        });
        if (out.length >= query.limit) break;
      }
    }
    return out;
  }

  /** Search result titles carry SEO noise; keep the leading, business-looking part. */
  private cleanTitle(title: string): string {
    const cut = title.split(/[|\-–—•»]/)[0].trim();
    return (cut.length >= 3 ? cut : title).slice(0, 160);
  }
}

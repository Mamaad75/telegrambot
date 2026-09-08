import { loadEnv } from '../../config/env';
import { ProviderError } from '../../lib/errors';
import { httpRequest } from '../../lib/http';
import { waitForHostSlot } from '../../lib/rate-limiter';
import { getCrawlerSettings } from '../../lib/settings';
import { fetchRobots, isPathAllowed } from '../../crawler/robots';
import type { FetchedPage, ProviderDescriptor, WebsiteProvider } from '../types';

/**
 * The website fetcher used by the audit engine.
 *
 * Everything about it is deliberately conservative: identified user agent, robots.txt
 * respected, one request per host at a time with a configurable delay, hard byte cap,
 * hard timeout, and no attempt whatsoever to work around bot protection. A site that
 * does not want to be read simply is not read, and the audit records that as
 * "unavailable" instead of guessing.
 */
export class HttpWebsiteProvider implements WebsiteProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'website_crawler',
    kind: 'WEBSITE',
    displayName: 'Website crawler',
    description:
      'Built-in polite HTTP crawler. Identifies itself, honours robots.txt and Crawl-delay, throttles per host and never bypasses bot protection.',
    requiredConfig: [],
    cost: 'FREE',
    defaultRateLimit: { perMinute: 60, perHour: 1200, perDay: 10000 },
    priority: 100,
  };

  isConfigured(): boolean {
    return true;
  }

  missingConfig(): string[] {
    return [];
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await httpRequest('https://example.com', { timeoutMs: 10000, retries: 0, providerKey: this.descriptor.key });
      return { ok: res.ok, message: res.ok ? 'Outbound HTTP is working' : `example.com returned ${res.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'no outbound access' };
    }
  }

  /** Check robots.txt before any fetch. Callers must not fetch when this returns false. */
  async isAllowed(url: string): Promise<{ allowed: boolean; reason?: string }> {
    const env = loadEnv();
    const settings = await getCrawlerSettings();
    if (!settings.respectRobots) return { allowed: true };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: 'invalid-url' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { allowed: false, reason: 'unsupported-protocol' };
    }

    const rules = await fetchRobots(parsed.origin, env.CRAWLER_USER_AGENT);
    if (rules.blockAll) return { allowed: false, reason: 'robots-disallow-all' };
    if (!isPathAllowed(rules, parsed.pathname)) return { allowed: false, reason: 'robots-disallow-path' };
    return { allowed: true };
  }

  async fetchPage(
    url: string,
    opts: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<FetchedPage> {
    const env = loadEnv();
    const settings = await getCrawlerSettings();

    const allowed = await this.isAllowed(url);
    if (!allowed.allowed) {
      throw new ProviderError(this.descriptor.key, `Blocked by robots.txt (${allowed.reason})`, { retryable: false });
    }

    const parsed = new URL(url);
    // Honour the site's own Crawl-delay when it asks for more than our default.
    const robots = await fetchRobots(parsed.origin, env.CRAWLER_USER_AGENT);
    const delayMs = Math.max(settings.delayMs, (robots.crawlDelaySeconds ?? 0) * 1000);
    await waitForHostSlot(parsed.host, delayMs);

    const res = await httpRequest(url, {
      timeoutMs: opts.timeoutMs ?? settings.timeoutMs,
      maxBytes: opts.maxBytes ?? settings.maxBytes,
      retries: 1,
      providerKey: this.descriptor.key,
      signal: opts.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fa-IR,fa;q=0.9,en;q=0.8',
      },
    });

    return {
      url,
      finalUrl: res.url,
      status: res.status,
      html: res.body,
      headers: res.headers,
      bytes: res.bytes,
      responseMs: res.durationMs,
      truncated: res.truncated,
    };
  }
}

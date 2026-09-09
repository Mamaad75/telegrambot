import { cacheGet, cacheSet } from '../lib/cache';
import { httpRequest } from '../lib/http';

/**
 * robots.txt parsing and enforcement.
 *
 * The crawler is opt-out friendly by default: if a site disallows our user agent we do
 * not fetch it, and we honour Crawl-delay. A fetch failure for robots.txt is treated as
 * "no rules" (the conventional interpretation), but a 401/403 on robots.txt is treated as
 * "disallow everything", which is the cautious reading.
 */

export interface RobotsRules {
  /** Path prefixes we may not fetch. */
  disallow: string[];
  /** Path prefixes explicitly permitted (they override a matching disallow). */
  allow: string[];
  crawlDelaySeconds: number | null;
  sitemaps: string[];
  /** True when the whole host is off limits. */
  blockAll: boolean;
  fetched: boolean;
}

const EMPTY: RobotsRules = { disallow: [], allow: [], crawlDelaySeconds: null, sitemaps: [], blockAll: false, fetched: false };

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const ua = userAgent.toLowerCase();
  const lines = text.split(/\r?\n/);

  // Group directives by the user-agent block they belong to.
  const groups: Array<{ agents: string[]; rules: Array<{ type: string; value: string }> }> = [];
  let current: { agents: string[]; rules: Array<{ type: string; value: string }> } | null = null;
  let lastWasAgent = false;
  const sitemaps: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (['disallow', 'allow', 'crawl-delay'].includes(field)) {
      current.rules.push({ type: field, value });
    }
  }

  // Most specific matching group wins: an exact-ish agent match beats the "*" group.
  const named = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const group = named ?? wildcard;

  if (!group) return { ...EMPTY, sitemaps, fetched: true };

  const disallow: string[] = [];
  const allow: string[] = [];
  let crawlDelay: number | null = null;

  for (const rule of group.rules) {
    if (rule.type === 'disallow') {
      // "Disallow:" with an empty value means "allow everything".
      if (rule.value !== '') disallow.push(rule.value);
    } else if (rule.type === 'allow') {
      if (rule.value !== '') allow.push(rule.value);
    } else if (rule.type === 'crawl-delay') {
      const n = Number(rule.value);
      if (Number.isFinite(n) && n >= 0) crawlDelay = n;
    }
  }

  return {
    disallow,
    allow,
    crawlDelaySeconds: crawlDelay,
    sitemaps,
    blockAll: disallow.includes('/') && !allow.length,
    fetched: true,
  };
}

/** Longest matching rule wins, as specified by the robots exclusion protocol. */
export function isPathAllowed(rules: RobotsRules, pathname: string): boolean {
  if (!rules.fetched) return true;
  const path = pathname || '/';
  const match = (patterns: string[]) =>
    patterns.reduce<number>((best, p) => {
      const literal = p.replace(/\*/g, '');
      if (p.includes('*')) {
        const regex = new RegExp(`^${p.split('*').map(escapeRegex).join('.*')}`);
        return regex.test(path) ? Math.max(best, literal.length) : best;
      }
      return path.startsWith(p) ? Math.max(best, p.length) : best;
    }, -1);

  const allowLen = match(rules.allow);
  const disallowLen = match(rules.disallow);
  if (disallowLen < 0) return true;
  return allowLen >= disallowLen;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fetch and cache a host's robots.txt for one hour. */
export async function fetchRobots(origin: string, userAgent: string): Promise<RobotsRules> {
  const cacheKey = `robots:${origin}:${userAgent.slice(0, 40)}`;
  const hit = await cacheGet<RobotsRules>(cacheKey);
  if (hit) return hit;

  let rules: RobotsRules = { ...EMPTY };
  try {
    const res = await httpRequest(`${origin}/robots.txt`, {
      timeoutMs: 10000,
      retries: 1,
      maxBytes: 512_000,
      providerKey: 'website_crawler',
      // robots.txt is fetched from a host somebody else chose, and it can redirect
      // anywhere, so it goes through the same address guard as the pages themselves.
      ssrfGuard: true,
    });

    if (res.status === 401 || res.status === 403) {
      // RFC 9309 classes 4xx as "unavailable" and permits crawling. We are deliberately
      // stricter for 401/403 specifically: a site that gates even robots.txt behind
      // authentication is signalling that anonymous clients are unwelcome.
      rules = { ...EMPTY, blockAll: true, disallow: ['/'], fetched: true };
    } else if (res.status >= 500) {
      // RFC 9309 §2.3.1.4: an "unreachable" status means assume complete disallow.
      rules = { ...EMPTY, blockAll: true, disallow: ['/'], fetched: true };
    } else if (res.ok && res.body.trim()) {
      rules = parseRobots(res.body, userAgent);
    } else {
      // 404, 410 or empty body: no restrictions published.
      rules = { ...EMPTY, fetched: true };
    }
  } catch {
    // Network failure reaching robots.txt: treat as "no rules published" and rely on our
    // own per-host throttling. Refusing to crawl on a transient DNS blip would make the
    // audit unreliable in a way the user could not diagnose.
    rules = { ...EMPTY, fetched: false };
  }

  await cacheSet(cacheKey, rules, 3600);
  return rules;
}

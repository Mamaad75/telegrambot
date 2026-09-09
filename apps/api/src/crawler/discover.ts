import { extractDomain } from '@baimar/shared';
import type { WebsiteStatus } from '@prisma/client';
import { loadEnv } from '../config/env';
import { callProvider } from '../providers/registry';
import type { SearchProvider, WebsiteProvider } from '../providers/types';
import { analyzePage } from './parse';
import { MATCH_THRESHOLDS, scoreWebsiteMatch, type MatchResult } from './website-match';

/**
 * Website discovery.
 *
 * "This business has no website" is one of the strongest sales signals Baimar has, so it
 * must be a conclusion, not an assumption. A candidate URL is only accepted after we have
 * fetched it and found corroborating evidence — the phone number, or the business name.
 * Anything weaker is stored as NOT_VERIFIED so a salesperson checks it before calling.
 */

export interface DiscoveryInput {
  businessName: string;
  city?: string | null;
  province?: string | null;
  address?: string | null;
  phone?: string | null;
  extraPhones?: string[];
  instagramUrl?: string | null;
  telegramUrl?: string | null;
  category?: string | null;
  /** Domains we already know are not this business (previously rejected). */
  excludeDomains?: string[];
}

export interface WebsiteDiscoveryResult {
  url: string | null;
  domain: string | null;
  status: WebsiteStatus;
  /** How the candidate was found. */
  method: 'search' | 'domain-probe' | 'none';
  confidence: 'FACT' | 'ESTIMATED' | 'UNKNOWN';
  evidence: string;
  candidatesConsidered: number;
  searchProviderUsed: string | null;
  /** Present when nothing was found and we want to explain why. */
  note?: string;
  /** 0-100. Null when no candidate was scored at all. */
  matchConfidence: number | null;
  /** Per-signal breakdown behind that number, stored on the lead for the UI. */
  matchSignals: MatchResult['signals'];
  matchReasons: string[];
  /**
   * Candidates that scored above WEAK but below the acceptance threshold. They are
   * offered to a salesperson as "is this them?" rather than silently attached.
   */
  suggestions: Array<{ url: string; domain: string; confidence: number; reasons: string[] }>;
}

const EXCLUDED_HOSTS = [
  'instagram.com', 'facebook.com', 'linkedin.com', 't.me', 'telegram.me', 'wa.me',
  'twitter.com', 'x.com', 'youtube.com', 'aparat.com', 'wikipedia.org',
  'google.com', 'maps.google.com', 'goo.gl', 'yelp.com', 'tripadvisor.com',
  'divar.ir', 'sheypoor.com', 'digikala.com', 'basalam.com', 'torob.com',
  'eitaa.com', 'balad.ir', 'neshan.org', 'kilid.com', 'delta.ir', 'jabama.com',
  'doctoreto.com', 'paziresh24.com', 'drdr.ir', 'nobat.ir', 'snapp.ir',
  'blogfa.com', 'blog.ir', 'mihanblog.com', 'persianblog.ir', 'rzb.ir',
];

function isExcluded(domain: string, extra: string[] = []): boolean {
  const all = [...EXCLUDED_HOSTS, ...extra];
  return all.some((h) => domain === h || domain.endsWith(`.${h}`));
}

export async function discoverWebsite(
  input: DiscoveryInput,
  deps: { searchProviders: SearchProvider[]; website: WebsiteProvider },
): Promise<WebsiteDiscoveryResult> {
  const base: WebsiteDiscoveryResult = {
    url: null,
    domain: null,
    status: 'NO_WEBSITE',
    method: 'none',
    confidence: 'UNKNOWN',
    evidence: '',
    candidatesConsidered: 0,
    searchProviderUsed: null,
    matchConfidence: null,
    matchSignals: [],
    matchReasons: [],
    suggestions: [],
  };

  const candidates: Array<{ url: string; domain: string; source: 'search' | 'probe'; rank: number; provider?: string }> = [];

  // --- 1. Ask a search provider, if one is configured ----------------------
  const location = [input.city, input.province].filter(Boolean).join(' ');
  for (const search of deps.searchProviders) {
    try {
      const query = [input.businessName, location, input.category].filter(Boolean).join(' ');
      const results = await callProvider(search, () => search.search(query, { count: 10, country: 'ir', language: 'fa' }));
      base.searchProviderUsed = search.descriptor.key;
      for (const r of results) {
        const domain = extractDomain(r.url);
        if (!domain || isExcluded(domain, input.excludeDomains)) continue;
        if (candidates.some((c) => c.domain === domain)) continue;
        candidates.push({ url: `https://${domain}`, domain, source: 'search', rank: r.rank, provider: search.descriptor.key });
      }
      if (candidates.length) break; // first provider that returned something wins
    } catch {
      // Provider failed — try the next one, and fall through to the domain probe.
      continue;
    }
  }

  // --- 2. Domain probing, for businesses with a Latin-script name ----------
  if (!candidates.length && loadEnv().DOMAIN_PROBE_ENABLED) {
    for (const domain of guessDomains(input.businessName)) {
      if (isExcluded(domain, input.excludeDomains)) continue;
      candidates.push({ url: `https://${domain}`, domain, source: 'probe', rank: 99 });
    }
  }

  base.candidatesConsidered = candidates.length;
  if (!candidates.length) {
    return {
      ...base,
      evidence: base.searchProviderUsed
        ? `No plausible website found via ${base.searchProviderUsed}`
        : 'No search provider is configured and the business name gave no domain to probe',
      note: base.searchProviderUsed
        ? undefined
        : 'Configure BRAVE_SEARCH_API_KEY or GOOGLE_CSE_API_KEY to improve website discovery.',
    };
  }

  // --- 3. Verify candidates by actually reading them ----------------------
  //
  // Never "first result wins". Each candidate is fetched and scored on independent
  // signals (phone, name, domain, city, address, shared social profile), and the best
  // score decides what the system is willing to claim. Attaching the wrong website to a
  // lead is worse than attaching none: the salesperson would open the call with a fact
  // about a stranger's site.
  const minConfidence = Math.max(
    MATCH_THRESHOLDS.WEAK,
    Math.min(100, loadEnv().WEBSITE_MATCH_MIN_CONFIDENCE),
  );

  const scored: Array<{ result: MatchResult; page: ReturnType<typeof analyzePage>; source: 'search' | 'probe' }> = [];

  for (const candidate of candidates.slice(0, 5)) {
    let page;
    try {
      const fetched = await deps.website.fetchPage(candidate.url);
      if (fetched.status >= 400) continue;
      page = analyzePage({
        url: candidate.url,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        html: fetched.html,
        bytes: fetched.bytes,
        responseMs: fetched.responseMs,
        truncated: fetched.truncated,
      });
    } catch {
      // A candidate we cannot read teaches us nothing; it is not evidence either way.
      continue;
    }

    const domain = extractDomain(page.finalUrl) ?? candidate.domain;
    const result = scoreWebsiteMatch(input, page, domain);
    scored.push({ result, page, source: candidate.source });
  }

  scored.sort((a, b) => b.result.confidence - a.result.confidence);
  const best = scored[0];

  const suggestions = scored
    .filter((s) => s.result.confidence >= MATCH_THRESHOLDS.WEAK && s.result.confidence < minConfidence)
    .map((s) => ({
      url: s.page.finalUrl,
      domain: extractDomain(s.page.finalUrl) ?? '',
      confidence: s.result.confidence,
      reasons: s.result.reasons,
    }));

  if (!best || best.result.confidence < minConfidence) {
    return {
      ...base,
      candidatesConsidered: candidates.length,
      matchConfidence: best?.result.confidence ?? null,
      matchSignals: best?.result.signals ?? [],
      matchReasons: best?.result.reasons ?? [],
      suggestions,
      evidence: best
        ? `${scored.length} نامزد بررسی شد؛ بهترین امتیاز ${best.result.confidence} از حد لازم ${minConfidence} کمتر بود.`
        : `${Math.min(candidates.length, 5)} نامزد بررسی شد؛ هیچ‌کدام قابل خواندن نبود.`,
      note:
        suggestions.length > 0
          ? 'نامزدهایی با اطمینان پایین یافت شد — برای تأیید انسانی ثبت شدند، اما به سرنخ متصل نشدند.'
          : undefined,
    };
  }

  // Above the acceptance threshold but below CONFIRMED: attach it, and say out loud
  // that a human should confirm before the salesperson quotes anything from it.
  const isConfirmed = best.result.verdict === 'CONFIRMED';

  return {
    url: best.page.finalUrl,
    domain: extractDomain(best.page.finalUrl),
    status: isConfirmed ? 'ACTIVE' : 'NOT_VERIFIED',
    method: best.source === 'search' ? 'search' : 'domain-probe',
    confidence: isConfirmed ? 'FACT' : 'ESTIMATED',
    evidence: best.result.reasons.join(' • ') || 'بدون شواهد مستقیم',
    candidatesConsidered: candidates.length,
    searchProviderUsed: base.searchProviderUsed,
    matchConfidence: best.result.confidence,
    matchSignals: best.result.signals,
    matchReasons: best.result.reasons,
    suggestions,
    note: isConfirmed
      ? undefined
      : `اطمینان ${best.result.confidence} از ۱۰۰ — پیش از استناد در تماس، توسط کارشناس تأیید شود.`,
  };
}

/**
 * Guess domains from a Latin-script business name. Persian-only names produce nothing —
 * we do not transliterate, because a wrong guess would be worse than "unknown".
 */
export function guessDomains(businessName: string): string[] {
  const latin = businessName
    .normalize('NFKD')
    .replace(/[^\p{ASCII}]/gu, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim();
  if (latin.length < 3) return [];

  const tokens = latin.split(/\s+/).filter((t) => t.length > 1 && !['the', 'co', 'ltd', 'inc', 'group'].includes(t));
  if (!tokens.length) return [];

  const joined = tokens.join('');
  const hyphenated = tokens.join('-');
  const bases = Array.from(new Set([joined, hyphenated, tokens[0]])).filter((b) => b.length >= 3 && b.length <= 40);

  const tlds = ['ir', 'com', 'co.ir'];
  const out: string[] = [];
  for (const base of bases) {
    for (const tld of tlds) out.push(`${base}.${tld}`);
  }
  return out.slice(0, 6);
}

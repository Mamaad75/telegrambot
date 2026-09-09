import { nameSimilarity, normalizeBusinessName, normalizePhone, normalizeText } from '@baimar/shared';
import type { PageAnalysis } from './parse';

/**
 * Website match confidence.
 *
 * The failure this module exists to prevent: a search engine returns *a* website for
 * "کلینیک زیبایی آرمان، اراک", and the system attaches it to the lead. The salesperson
 * opens the brief, reads "your website has no mobile viewport", phones the business —
 * and is talking about somebody else's website. That call is unrecoverable. It is far
 * better to say "website unknown" than to say the wrong thing confidently.
 *
 * So a candidate is never accepted on the strength of being the first search result.
 * Independent signals are scored, the evidence for each is recorded, and the total
 * decides what the system is willing to claim:
 *
 *   >= 80  CONFIRMED   attach as the verified website
 *   >= 55  PROBABLE    attach, but flagged NOT_VERIFIED for a human to confirm
 *   >= 30  WEAK        keep as a suggestion only; never shown as "their website"
 *    < 30  REJECTED    discarded
 *
 * Every number below is a deliberate weight, not a tuning artefact: a phone number is
 * nearly unique to one business, a name in a page title is strong but imitable, and a
 * city name is weak on its own because thousands of pages mention Tehran.
 */

export interface MatchSignal {
  key: string;
  /** Persian label, shown in the lead's "why we think this is their site" panel. */
  labelFa: string;
  points: number;
  maxPoints: number;
  matched: boolean;
  /** What was actually observed. Empty when the signal did not match. */
  evidence: string;
}

export type MatchVerdict = 'CONFIRMED' | 'PROBABLE' | 'WEAK' | 'REJECTED';

export interface MatchResult {
  confidence: number;
  verdict: MatchVerdict;
  signals: MatchSignal[];
  /** Matched signals, as short Persian phrases for the UI. */
  reasons: string[];
  /** Reasons the score was pushed down, if any. */
  penalties: string[];
}

export interface MatchInput {
  businessName: string;
  city?: string | null;
  province?: string | null;
  address?: string | null;
  phone?: string | null;
  extraPhones?: string[];
  instagramUrl?: string | null;
  telegramUrl?: string | null;
  category?: string | null;
}

export const MATCH_THRESHOLDS = { CONFIRMED: 80, PROBABLE: 55, WEAK: 30 } as const;

/** Words that make a page a parking/holding page rather than a business website. */
const PARKED_MARKERS = [
  'this domain is for sale',
  'domain for sale',
  'buy this domain',
  'parked domain',
  'coming soon',
  'under construction',
  'default web site page',
  'welcome to nginx',
  'apache2 ubuntu default page',
  'it works!',
  'دامنه به فروش می‌رسد',
  'این دامنه برای فروش',
  'به زودی',
  'در دست ساخت',
];

/** Hosts that list many businesses; a hit there is never "their website". */
const DIRECTORY_MARKERS = ['نیازمندی', 'آگهی رایگان', 'ثبت آگهی', 'لیست مشاغل', 'business directory', 'yellow pages'];

function domainSimilarityToName(domain: string, businessName: string): number {
  // Compare the domain label against a Latin transliteration-free reduction of the name.
  const label = domain.replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (label.length < 3) return 0;

  const latin = businessName
    .normalize('NFKD')
    .replace(/[^\p{ASCII}]/gu, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
  if (latin.length < 3) return 0;

  if (label === latin) return 1;
  if (label.includes(latin) || latin.includes(label)) return 0.8;
  return nameSimilarity(label, latin);
}

function tokenOverlap(a: string, b: string): number {
  const at = new Set(normalizeText(a).split(' ').filter((t) => t.length > 2));
  const bt = new Set(normalizeText(b).split(' ').filter((t) => t.length > 2));
  if (at.size === 0 || bt.size === 0) return 0;
  let hits = 0;
  for (const t of at) if (bt.has(t)) hits++;
  return hits / at.size;
}

/**
 * Score one candidate page against what we already know about the business.
 *
 * `page` must be a page that was actually fetched — this never scores a search snippet,
 * because a snippet is written by the search engine, not by the business.
 */
export function scoreWebsiteMatch(input: MatchInput, page: PageAnalysis, domain: string): MatchResult {
  const signals: MatchSignal[] = [];
  const penalties: string[] = [];

  const haystack = normalizeText(`${page.title ?? ''} ${page.metaDescription ?? ''} ${page.h1.join(' ')} ${page.textSample}`);
  const nameNorm = normalizeBusinessName(input.businessName);

  /* --- Phone: the strongest signal there is ------------------------------ */
  const knownPhones = [input.phone, ...(input.extraPhones ?? [])]
    .map((p) => normalizePhone(p ?? null))
    .filter((p) => p.valid && p.e164)
    .map((p) => p.e164!);
  const phoneHit = knownPhones.find((p) => page.phones.includes(p));
  signals.push({
    key: 'phone',
    labelFa: 'شماره تماس کسب‌وکار در سایت',
    points: phoneHit ? 40 : 0,
    maxPoints: 40,
    matched: Boolean(phoneHit),
    // A phone number is close to unique: two unrelated businesses rarely publish the same one.
    evidence: phoneHit ? `شمارهٔ ${phoneHit} در صفحه دیده شد` : '',
  });

  /* --- Business name in the title ---------------------------------------- */
  const titleSim = page.title ? nameSimilarity(input.businessName, page.title) : 0;
  const titlePoints = titleSim >= 0.8 ? 20 : titleSim >= 0.6 ? 14 : titleSim >= 0.45 ? 7 : 0;
  signals.push({
    key: 'title',
    labelFa: 'نام کسب‌وکار در عنوان صفحه',
    points: titlePoints,
    maxPoints: 20,
    matched: titlePoints > 0,
    evidence: titlePoints > 0 ? `عنوان: «${page.title}» (شباهت ${titleSim.toFixed(2)})` : '',
  });

  /* --- Business name in the body ----------------------------------------- */
  const nameInBody = nameNorm.length >= 4 && haystack.includes(nameNorm);
  signals.push({
    key: 'name_in_body',
    labelFa: 'نام کسب‌وکار در متن صفحه',
    points: nameInBody ? 10 : 0,
    maxPoints: 10,
    matched: nameInBody,
    evidence: nameInBody ? 'نام کسب‌وکار در محتوای صفحه آمده است' : '',
  });

  /* --- Domain resembles the business name --------------------------------- */
  const domainSim = domainSimilarityToName(domain, input.businessName);
  const domainPoints = domainSim >= 0.9 ? 12 : domainSim >= 0.7 ? 8 : domainSim >= 0.5 ? 4 : 0;
  signals.push({
    key: 'domain',
    labelFa: 'شباهت دامنه به نام کسب‌وکار',
    points: domainPoints,
    maxPoints: 12,
    matched: domainPoints > 0,
    evidence: domainPoints > 0 ? `دامنهٔ ${domain} با نام کسب‌وکار هم‌خوان است (${domainSim.toFixed(2)})` : '',
  });

  /* --- City ---------------------------------------------------------------- */
  const cityNorm = input.city ? normalizeText(input.city) : '';
  const cityHit = cityNorm.length >= 2 && haystack.includes(cityNorm);
  signals.push({
    key: 'city',
    labelFa: 'شهر کسب‌وکار در صفحه',
    points: cityHit ? 8 : 0,
    maxPoints: 8,
    matched: cityHit,
    // Weak on its own — plenty of sites mention Tehran — but it corroborates the rest.
    evidence: cityHit ? `نام شهر «${input.city}» در صفحه آمده است` : '',
  });

  /* --- Address ------------------------------------------------------------- */
  const addressOverlap = input.address ? tokenOverlap(input.address, haystack) : 0;
  const addressPoints = addressOverlap >= 0.5 ? 10 : addressOverlap >= 0.3 ? 5 : 0;
  signals.push({
    key: 'address',
    labelFa: 'نشانی کسب‌وکار در صفحه',
    points: addressPoints,
    maxPoints: 10,
    matched: addressPoints > 0,
    evidence: addressPoints > 0 ? `${Math.round(addressOverlap * 100)}٪ از واژه‌های نشانی در صفحه دیده شد` : '',
  });

  /* --- Social profile ------------------------------------------------------ */
  const socialHandle = (url?: string | null): string | null => {
    if (!url) return null;
    const m = url.match(/(?:instagram\.com|t\.me)\/+([A-Za-z0-9._-]+)/i);
    return m ? m[1].toLowerCase() : null;
  };
  const knownSocial = [socialHandle(input.instagramUrl), socialHandle(input.telegramUrl)].filter(Boolean) as string[];
  const pageSocial = [socialHandle(page.instagramUrl), socialHandle(page.telegramUrl)].filter(Boolean) as string[];
  const socialHit = knownSocial.find((h) => pageSocial.includes(h));
  signals.push({
    key: 'social',
    labelFa: 'پیوند شبکهٔ اجتماعی مشترک',
    points: socialHit ? 10 : 0,
    maxPoints: 10,
    matched: Boolean(socialHit),
    evidence: socialHit ? `همان پیج «@${socialHit}» در سایت لینک شده است` : '',
  });

  /* --- Category keywords ---------------------------------------------------- */
  const categoryOverlap = input.category ? tokenOverlap(input.category, haystack) : 0;
  signals.push({
    key: 'category',
    labelFa: 'هم‌خوانی حوزهٔ فعالیت',
    points: categoryOverlap >= 0.5 ? 5 : 0,
    maxPoints: 5,
    matched: categoryOverlap >= 0.5,
    evidence: categoryOverlap >= 0.5 ? `واژه‌های حوزهٔ «${input.category}» در صفحه آمده است` : '',
  });

  let confidence = signals.reduce((sum, s) => sum + s.points, 0);

  /* --- Penalties ----------------------------------------------------------- */
  const lowerText = `${page.title ?? ''} ${page.textSample}`.toLowerCase();
  if (PARKED_MARKERS.some((m) => lowerText.includes(m))) {
    confidence -= 40;
    penalties.push('صفحه پارک‌شده یا «به‌زودی» است، نه وب‌سایت فعال کسب‌وکار');
  }
  if (DIRECTORY_MARKERS.some((m) => lowerText.includes(m))) {
    confidence -= 25;
    penalties.push('صفحه یک دایرکتوری یا سایت آگهی است، نه سایت اختصاصی کسب‌وکار');
  }
  if (page.wordCount < 40) {
    confidence -= 15;
    penalties.push('صفحه تقریباً بدون محتوا است');
  }
  // Name and phone both absent means nothing actually ties this page to the business.
  if (!phoneHit && titlePoints === 0 && !nameInBody) {
    confidence -= 20;
    penalties.push('هیچ نشانهٔ مستقیمی از این کسب‌وکار در صفحه پیدا نشد');
  }

  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  const verdict: MatchVerdict =
    confidence >= MATCH_THRESHOLDS.CONFIRMED
      ? 'CONFIRMED'
      : confidence >= MATCH_THRESHOLDS.PROBABLE
        ? 'PROBABLE'
        : confidence >= MATCH_THRESHOLDS.WEAK
          ? 'WEAK'
          : 'REJECTED';

  return {
    confidence,
    verdict,
    signals,
    reasons: signals.filter((s) => s.matched).map((s) => `${s.labelFa}: ${s.evidence}`),
    penalties,
  };
}

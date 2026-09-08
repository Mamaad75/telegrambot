import * as cheerio from 'cheerio';
import { extractDomain, extractPhones, normalizeUrl } from '@baimar/shared';

/**
 * Structural analysis of a single HTML page.
 *
 * Everything here is an *observation*: what markup the page actually contains. No scores
 * are computed at this level, and nothing is inferred — the audit engine turns these
 * observations into scores, and records which observations it could not make.
 */

export interface PageAnalysis {
  url: string;
  finalUrl: string;
  status: number;
  bytes: number;
  responseMs: number;
  truncated: boolean;

  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;
  robotsMeta: string | null;
  lang: string | null;
  dir: string | null;
  charset: string | null;

  h1: string[];
  h2: string[];
  h3Count: number;
  wordCount: number;
  textSample: string;

  hasViewport: boolean;
  viewportContent: string | null;
  /** Fixed pixel widths on the body/container are a strong non-responsive signal. */
  fixedWidthHints: string[];
  hasMediaQueries: boolean;

  formCount: number;
  hasContactForm: boolean;
  inputTypes: string[];

  imageCount: number;
  imagesWithoutAlt: number;
  /** Images served without width/height, a layout-shift indicator. */
  imagesWithoutDimensions: number;
  hasLazyLoading: boolean;

  internalLinks: number;
  externalLinks: number;
  links: string[];
  socialLinks: string[];
  instagramUrl: string | null;
  telegramUrl: string | null;
  whatsappUrl: string | null;
  linkedinUrl: string | null;
  facebookUrl: string | null;
  aparatUrl: string | null;

  phones: string[];
  emails: string[];

  ctaCount: number;
  ctaSamples: string[];
  hasPhoneLink: boolean;
  hasMapEmbed: boolean;

  hasFavicon: boolean;
  hasLogo: boolean;
  hasOpenGraph: boolean;
  structuredDataTypes: string[];

  scriptCount: number;
  externalScriptCount: number;
  stylesheetCount: number;
  inlineStyleBytes: number;

  /** Markup that only appears on sites built a long time ago. */
  legacyMarkup: string[];
  hasFlash: boolean;
  hasFrames: boolean;
  tableLayoutScore: number;

  hasEcommerceSignals: boolean;
  ecommerceEvidence: string[];
  hasBookingSignals: boolean;
  bookingEvidence: string[];
  hasAnalytics: boolean;
  analyticsEvidence: string[];
  hasChatWidget: boolean;

  hasTrustSignals: boolean;
  trustEvidence: string[];

  /** Best guess at what this page is for, used to pick which pages to crawl next. */
  role: 'home' | 'contact' | 'about' | 'services' | 'products' | 'blog' | 'other';
}

const SOCIAL_PATTERNS: Array<{ key: keyof PageAnalysis; re: RegExp }> = [
  { key: 'instagramUrl', re: /instagram\.com\/[A-Za-z0-9._]+/i },
  { key: 'telegramUrl', re: /(?:t\.me|telegram\.me)\/[A-Za-z0-9_]+/i },
  { key: 'whatsappUrl', re: /(?:wa\.me|api\.whatsapp\.com)\/[^"'\s]+/i },
  { key: 'linkedinUrl', re: /linkedin\.com\/(?:company|in)\/[^"'\s]+/i },
  { key: 'facebookUrl', re: /facebook\.com\/[^"'\s]+/i },
  { key: 'aparatUrl', re: /aparat\.com\/[^"'\s]+/i },
];

const CTA_WORDS = [
  'تماس', 'مشاوره', 'رزرو', 'نوبت', 'سفارش', 'ثبت نام', 'ثبت‌نام', 'درخواست', 'خرید',
  'استعلام', 'همین حالا', 'شروع', 'دریافت', 'ارسال',
  'contact', 'call', 'book', 'order', 'buy', 'get started', 'request', 'sign up', 'quote', 'consult',
];

const ECOMMERCE_MARKERS = [
  'سبد خرید', 'افزودن به سبد', 'تسویه حساب', 'پرداخت آنلاین', 'درگاه پرداخت', 'فروشگاه',
  'add to cart', 'add-to-cart', 'checkout', 'shopping cart', 'woocommerce', 'shop',
];

const BOOKING_MARKERS = [
  'رزرو آنلاین', 'نوبت‌دهی', 'نوبت دهی', 'دریافت نوبت', 'رزرو نوبت', 'تعیین وقت',
  'book an appointment', 'book now', 'schedule appointment', 'reservation', 'booking',
];

const ANALYTICS_MARKERS: Array<[string, string]> = [
  ['googletagmanager.com', 'Google Tag Manager'],
  ['google-analytics.com', 'Google Analytics'],
  ['gtag(', 'Google gtag.js'],
  ['clarity.ms', 'Microsoft Clarity'],
  ['yektanet', 'Yektanet'],
  ['metrix.ir', 'Metrix'],
  ['matomo', 'Matomo'],
  ['plausible.io', 'Plausible'],
  ['hotjar', 'Hotjar'],
];

const TRUST_MARKERS = [
  'نماد اعتماد', 'enamad', 'ساماندهی', 'samandehi', 'گواهی', 'مجوز', 'پروانه',
  'نظرات مشتریان', 'رضایت مشتری', 'testimonial', 'certificate', 'license',
];

const CHAT_MARKERS = ['goftino', 'raychat', 'crisp.chat', 'tawk.to', 'livechat', 'intercom', 'zendesk'];

export function analyzePage(input: {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  bytes: number;
  responseMs: number;
  truncated: boolean;
}): PageAnalysis {
  const $ = cheerio.load(input.html);
  const html = input.html;
  const lowerHtml = html.toLowerCase();
  const baseDomain = extractDomain(input.finalUrl);

  // Remove non-content elements before measuring text.
  const $text = cheerio.load(input.html);
  $text('script, style, noscript, svg').remove();
  const text = $text('body').text().replace(/\s+/g, ' ').trim();

  const links: string[] = [];
  let internalLinks = 0;
  let externalLinks = 0;
  let hasPhoneLink = false;

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href) return;
    if (href.startsWith('tel:')) {
      hasPhoneLink = true;
      return;
    }
    if (href.startsWith('mailto:') || href.startsWith('javascript:') || href.startsWith('#')) return;
    const abs = absoluteUrl(href, input.finalUrl);
    if (!abs) return;
    links.push(abs);
    const d = extractDomain(abs);
    if (d && baseDomain && (d === baseDomain || d.endsWith(`.${baseDomain}`))) internalLinks++;
    else externalLinks++;
  });

  const socialLinks = Array.from(
    new Set(
      links.filter((l) =>
        /(instagram|t\.me|telegram|wa\.me|whatsapp|linkedin|facebook|aparat|twitter|x\.com|youtube)\./i.test(l),
      ),
    ),
  );

  const social: Record<string, string | null> = {};
  for (const { key, re } of SOCIAL_PATTERNS) {
    const match = html.match(re);
    social[key as string] = match ? normalizeUrl(match[0]) : null;
  }

  let imagesWithoutAlt = 0;
  let imagesWithoutDimensions = 0;
  let hasLazyLoading = false;
  $('img').each((_, el) => {
    const $el = $(el);
    const alt = $el.attr('alt');
    if (alt === undefined || alt.trim() === '') imagesWithoutAlt++;
    if (!$el.attr('width') || !$el.attr('height')) imagesWithoutDimensions++;
    if ($el.attr('loading') === 'lazy') hasLazyLoading = true;
  });

  const inputTypes: string[] = [];
  $('input, textarea, select').each((_, el) => {
    const t = ($(el).attr('type') ?? el.tagName ?? 'text').toLowerCase();
    inputTypes.push(t);
  });
  const formCount = $('form').length;
  const hasContactForm =
    formCount > 0 &&
    (inputTypes.some((t) => ['tel', 'email'].includes(t)) ||
      $('textarea').length > 0 ||
      /contact|تماس|پیام|ارتباط/i.test($('form').text() + ($('form').attr('action') ?? '')));

  const ctaSamples: string[] = [];
  $('a, button, input[type=submit]').each((_, el) => {
    const label = ($(el).text() || $(el).attr('value') || '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 60) return;
    const lower = label.toLowerCase();
    if (CTA_WORDS.some((w) => lower.includes(w.toLowerCase()))) ctaSamples.push(label);
  });

  const structuredDataTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      const collect = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        if (typeof obj['@type'] === 'string') structuredDataTypes.push(obj['@type'] as string);
        if (Array.isArray(obj['@graph'])) (obj['@graph'] as unknown[]).forEach(collect);
      };
      if (Array.isArray(parsed)) parsed.forEach(collect);
      else collect(parsed);
    } catch {
      /* malformed JSON-LD is itself a finding, but not a parse failure */
    }
  });

  const legacyMarkup: string[] = [];
  for (const tag of ['font', 'center', 'marquee', 'blink', 'frameset', 'frame', 'applet']) {
    if ($(tag).length > 0) legacyMarkup.push(`<${tag}>`);
  }
  if (/<table[^>]*(?:width|border|cellpadding|cellspacing)=/i.test(html)) legacyMarkup.push('table layout attributes');
  if (/bgcolor=/i.test(html)) legacyMarkup.push('bgcolor attribute');

  const tableCount = $('table').length;
  const tableLayoutScore = tableCount > 0 ? Math.min(1, ($('table table').length + tableCount) / 5) : 0;

  const viewport = $('meta[name="viewport"]').attr('content') ?? null;
  const fixedWidthHints: string[] = [];
  const styleBlocks = $('style').text();
  const inlineStyles = $('[style]')
    .map((_, el) => $(el).attr('style') ?? '')
    .get()
    .join(';');
  const allCss = `${styleBlocks};${inlineStyles}`;
  const fixedWidth = allCss.match(/width\s*:\s*(\d{3,4})px/gi) ?? [];
  for (const m of fixedWidth.slice(0, 5)) {
    const px = Number(m.match(/(\d{3,4})/)?.[1] ?? 0);
    if (px >= 900) fixedWidthHints.push(m.trim());
  }

  const evidenceOf = (markers: string[]) =>
    markers.filter((m) => lowerHtml.includes(m.toLowerCase()));
  const ecommerceEvidence = evidenceOf(ECOMMERCE_MARKERS);
  const bookingEvidence = evidenceOf(BOOKING_MARKERS);
  const trustEvidence = evidenceOf(TRUST_MARKERS);
  const analyticsEvidence = ANALYTICS_MARKERS.filter(([m]) => lowerHtml.includes(m)).map(([, label]) => label);

  const words = text.split(/\s+/).filter(Boolean);

  return {
    url: input.url,
    finalUrl: input.finalUrl,
    status: input.status,
    bytes: input.bytes,
    responseMs: input.responseMs,
    truncated: input.truncated,

    title: $('title').first().text().trim() || null,
    titleLength: $('title').first().text().trim().length,
    metaDescription: $('meta[name="description"]').attr('content')?.trim() ?? null,
    metaDescriptionLength: ($('meta[name="description"]').attr('content') ?? '').trim().length,
    canonical: $('link[rel="canonical"]').attr('href') ?? null,
    robotsMeta: $('meta[name="robots"]').attr('content') ?? null,
    lang: $('html').attr('lang') ?? null,
    dir: $('html').attr('dir') ?? null,
    charset: $('meta[charset]').attr('charset') ?? null,

    h1: $('h1').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).slice(0, 10),
    h2: $('h2').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).slice(0, 20),
    h3Count: $('h3').length,
    wordCount: words.length,
    textSample: text.slice(0, 4000),

    hasViewport: Boolean(viewport),
    viewportContent: viewport,
    fixedWidthHints,
    hasMediaQueries: /@media[^{]*\(/i.test(styleBlocks) || $('link[media]').length > 0,

    formCount,
    hasContactForm,
    inputTypes: Array.from(new Set(inputTypes)),

    imageCount: $('img').length,
    imagesWithoutAlt,
    imagesWithoutDimensions,
    hasLazyLoading,

    internalLinks,
    externalLinks,
    links: Array.from(new Set(links)).slice(0, 300),
    socialLinks,
    instagramUrl: social.instagramUrl ?? null,
    telegramUrl: social.telegramUrl ?? null,
    whatsappUrl: social.whatsappUrl ?? null,
    linkedinUrl: social.linkedinUrl ?? null,
    facebookUrl: social.facebookUrl ?? null,
    aparatUrl: social.aparatUrl ?? null,

    phones: extractPhones(text).slice(0, 10),
    emails: Array.from(new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])).slice(0, 10),

    ctaCount: ctaSamples.length,
    ctaSamples: Array.from(new Set(ctaSamples)).slice(0, 10),
    hasPhoneLink,
    hasMapEmbed: /maps\.google|neshan\.org|balad\.ir|openstreetmap/i.test(html),

    hasFavicon: $('link[rel*="icon"]').length > 0,
    hasLogo:
      $('img[class*="logo"], img[id*="logo"], img[alt*="logo" i], .logo img, header img').length > 0 ||
      $('svg[class*="logo"]').length > 0,
    hasOpenGraph: $('meta[property^="og:"]').length > 0,
    structuredDataTypes: Array.from(new Set(structuredDataTypes)),

    scriptCount: $('script').length,
    externalScriptCount: $('script[src]').length,
    stylesheetCount: $('link[rel="stylesheet"]').length,
    inlineStyleBytes: Buffer.byteLength(styleBlocks),

    legacyMarkup,
    hasFlash: /\.swf|application\/x-shockwave-flash/i.test(html),
    hasFrames: $('frameset, frame, iframe[src*="frame"]').length > 0,
    tableLayoutScore,

    hasEcommerceSignals: ecommerceEvidence.length > 0,
    ecommerceEvidence,
    hasBookingSignals: bookingEvidence.length > 0,
    bookingEvidence,
    hasAnalytics: analyticsEvidence.length > 0,
    analyticsEvidence,
    hasChatWidget: CHAT_MARKERS.some((m) => lowerHtml.includes(m)),

    hasTrustSignals: trustEvidence.length > 0,
    trustEvidence,

    role: classifyPage(input.finalUrl, $('title').first().text()),
  };
}

export function absoluteUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function classifyPage(url: string, title: string): PageAnalysis['role'] {
  const haystack = `${url} ${title}`.toLowerCase();
  let path = '/';
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep default */
  }
  if (path === '/' || path === '') return 'home';
  if (/contact|تماس|ارتباط/.test(haystack)) return 'contact';
  if (/about|درباره|معرفی/.test(haystack)) return 'about';
  if (/service|خدمات|solutions/.test(haystack)) return 'services';
  if (/product|shop|store|محصول|فروشگاه/.test(haystack)) return 'products';
  if (/blog|news|article|مقال|وبلاگ|اخبار/.test(haystack)) return 'blog';
  return 'other';
}

/** Pick the most informative internal links to visit next, one per page role. */
export function pickNextUrls(analysis: PageAnalysis, alreadySeen: Set<string>, max: number): string[] {
  const scored: Array<{ url: string; score: number }> = [];
  for (const link of analysis.links) {
    if (alreadySeen.has(link)) continue;
    let path: string;
    try {
      const u = new URL(link);
      path = u.pathname.toLowerCase();
      // Skip obvious noise: files, pagination, filters, login areas.
      if (/\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?|mp4|mp3|webp)$/i.test(path)) continue;
      if (u.search.length > 60) continue;
      if (/\/(wp-admin|wp-login|cart|checkout|my-account|login|register)/i.test(path)) continue;
    } catch {
      continue;
    }
    let score = 0;
    if (/contact|تماس|ارتباط/i.test(link)) score += 10;
    if (/about|درباره/i.test(link)) score += 8;
    if (/service|خدمات/i.test(link)) score += 7;
    if (/product|shop|فروشگاه|محصول/i.test(link)) score += 6;
    if (/blog|مقال|وبلاگ/i.test(link)) score += 3;
    if (path.split('/').filter(Boolean).length <= 2) score += 2;
    scored.push({ url: link, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.url);
}

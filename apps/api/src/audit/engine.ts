import {
  APPOINTMENT_HINTS,
  PRODUCT_SELLING_HINTS,
  extractDomain,
  matchesCategoryHints,
  normalizeUrl,
  type AuditFinding,
  type DetectedTechnology,
} from '@baimar/shared';
import { ProviderError } from '../lib/errors';
import { getCrawlerSettings } from '../lib/settings';
import { analyzePage, pickNextUrls, type PageAnalysis } from '../crawler/parse';
import { detectTechnologies, legacyIndicators } from '../crawler/tech-detect';
import { httpRequest } from '../lib/http';
import type { WebsiteProvider } from '../providers/types';
import { averageOf, check, fail, findingsFrom, pass, scoreArea, unavailable, type Check } from './checks';

/**
 * Website audit engine.
 *
 * Crawls a small, polite sample of a business website and turns what it actually observed
 * into six normalized scores plus a list of findings. Two rules govern everything here:
 *
 *   1. Never fabricate a measurement. We do not run Lighthouse or PageSpeed, so we do not
 *      report Lighthouse numbers — the corresponding checks are recorded as UNAVAILABLE
 *      and the UI says so.
 *   2. Always keep the raw observation. Scores can be recomputed from `raw` without
 *      re-crawling the site.
 */

export interface AuditResult {
  url: string;
  finalUrl: string | null;
  reachable: boolean;
  httpStatus: number | null;
  redirectChain: string[];

  scores: {
    seo: number | null;
    mobile: number | null;
    performance: number | null;
    ux: number | null;
    conversion: number | null;
    technical: number | null;
    accessibility: number | null;
    overall: number | null;
  };
  unavailableMeasurements: string[];
  findings: AuditFinding[];
  technologies: DetectedTechnology[];
  legacySignals: string[];

  pages: PageAnalysis[];
  pagesCrawled: number;
  totalBytes: number;
  responseMs: number | null;

  hasSsl: boolean | null;
  hasViewport: boolean | null;
  hasContactForm: boolean | null;
  hasContactPage: boolean | null;
  hasAboutPage: boolean | null;
  hasBlog: boolean | null;
  hasEcommerce: boolean | null;
  hasBooking: boolean | null;
  hasAnalytics: boolean | null;
  hasFavicon: boolean | null;
  hasLogo: boolean | null;
  hasSitemap: boolean | null;
  hasRobots: boolean | null;
  hasStructuredData: boolean | null;

  socialLinks: string[];
  discoveredPhones: string[];
  discoveredEmails: string[];

  raw: Record<string, unknown>;
  error: string | null;
  /** Set when the site explicitly refused crawling; not a failure of ours. */
  blockedByRobots: boolean;
}

export interface AuditOptions {
  maxPages?: number;
  signal?: AbortSignal;
  /** Hint used by the conversion checks: an appointment business is judged differently. */
  businessCategory?: string | null;
}

export async function auditWebsite(
  rawUrl: string,
  website: WebsiteProvider,
  opts: AuditOptions = {},
): Promise<AuditResult> {
  const settings = await getCrawlerSettings();
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? settings.maxPages, 20));

  const startUrl = normalizeUrl(rawUrl);
  const result = emptyResult(rawUrl);
  if (!startUrl) {
    result.error = 'The stored website value is not a usable URL';
    return result;
  }

  const origin = new URL(startUrl).origin;
  const domain = extractDomain(startUrl);

  // --- Reachability and transport -----------------------------------------
  let homepage: PageAnalysis | null = null;
  let homepageHeaders: Record<string, string> = {};
  let homepageHtml = '';
  const redirectChain: string[] = [];

  try {
    const httpsUrl = startUrl.replace(/^http:/, 'https:');
    const fetched = await website.fetchPage(httpsUrl, { signal: opts.signal });
    result.httpStatus = fetched.status;
    result.reachable = fetched.status > 0 && fetched.status < 500;
    result.finalUrl = fetched.finalUrl;
    result.hasSsl = fetched.finalUrl.startsWith('https:');
    if (fetched.finalUrl !== httpsUrl) redirectChain.push(fetched.finalUrl);
    homepageHtml = fetched.html;
    homepageHeaders = fetched.headers;
    homepage = analyzePage({
      url: httpsUrl,
      finalUrl: fetched.finalUrl,
      status: fetched.status,
      html: fetched.html,
      bytes: fetched.bytes,
      responseMs: fetched.responseMs,
      truncated: fetched.truncated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ProviderError && message.includes('robots.txt')) {
      result.blockedByRobots = true;
      result.error = 'The site’s robots.txt asks crawlers not to read it. No audit was performed.';
      result.unavailableMeasurements.push('all-measurements-blocked-by-robots');
      return result;
    }
    // HTTPS failed — try plain HTTP so we can still report "no SSL" rather than "unknown".
    try {
      const httpUrl = startUrl.replace(/^https:/, 'http:');
      const fetched = await website.fetchPage(httpUrl, { signal: opts.signal });
      result.httpStatus = fetched.status;
      result.reachable = fetched.status > 0 && fetched.status < 500;
      result.finalUrl = fetched.finalUrl;
      result.hasSsl = fetched.finalUrl.startsWith('https:');
      homepageHtml = fetched.html;
      homepageHeaders = fetched.headers;
      homepage = analyzePage({
        url: httpUrl,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        html: fetched.html,
        bytes: fetched.bytes,
        responseMs: fetched.responseMs,
        truncated: fetched.truncated,
      });
    } catch (err2) {
      result.error = err2 instanceof Error ? err2.message : String(err2);
      result.reachable = false;
      result.hasSsl = null;
      result.unavailableMeasurements.push('site-unreachable');
      return result;
    }
  }

  if (!homepage) {
    result.error = 'Could not read the homepage';
    return result;
  }

  const pages: PageAnalysis[] = [homepage];
  const seen = new Set<string>([homepage.finalUrl, startUrl]);

  // --- Crawl a small sample of internal pages ------------------------------
  const queue = pickNextUrls(homepage, seen, maxPages - 1);
  for (const url of queue) {
    if (pages.length >= maxPages) break;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const fetched = await website.fetchPage(url, { signal: opts.signal });
      const analysis = analyzePage({
        url,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        html: fetched.html,
        bytes: fetched.bytes,
        responseMs: fetched.responseMs,
        truncated: fetched.truncated,
      });
      pages.push(analysis);
    } catch {
      // One unreachable sub-page is normal; the audit continues with what it has.
      continue;
    }
  }

  // --- Site-level probes ---------------------------------------------------
  const [robotsProbe, sitemapProbe] = await Promise.all([
    probe(`${origin}/robots.txt`, opts.signal),
    probe(`${origin}/sitemap.xml`, opts.signal),
  ]);
  result.hasRobots = robotsProbe;
  result.hasSitemap = sitemapProbe;

  // --- Aggregate observations ---------------------------------------------
  const technologies = detectTechnologies(homepageHtml, homepageHeaders);
  const legacySignals = legacyIndicators(homepageHtml, technologies);

  const anyPage = (pick: (p: PageAnalysis) => boolean) => pages.some(pick);
  const totalBytes = pages.reduce((s, p) => s + p.bytes, 0);
  const avgResponse = averageOf(pages, (p) => p.responseMs);

  result.finalUrl = homepage.finalUrl;
  result.redirectChain = redirectChain;
  result.pages = pages;
  result.pagesCrawled = pages.length;
  result.totalBytes = totalBytes;
  result.responseMs = avgResponse === null ? null : Math.round(avgResponse);
  result.technologies = technologies;
  result.legacySignals = legacySignals;

  result.hasViewport = homepage.hasViewport;
  result.hasContactForm = anyPage((p) => p.hasContactForm);
  result.hasContactPage = anyPage((p) => p.role === 'contact');
  result.hasAboutPage = anyPage((p) => p.role === 'about');
  result.hasBlog = anyPage((p) => p.role === 'blog');
  result.hasEcommerce =
    anyPage((p) => p.hasEcommerceSignals) || technologies.some((t) => t.category === 'E-commerce');
  result.hasBooking = anyPage((p) => p.hasBookingSignals);
  result.hasAnalytics = anyPage((p) => p.hasAnalytics);
  result.hasFavicon = homepage.hasFavicon;
  result.hasLogo = homepage.hasLogo;
  result.hasStructuredData = anyPage((p) => p.structuredDataTypes.length > 0);

  result.socialLinks = Array.from(new Set(pages.flatMap((p) => p.socialLinks)));
  result.discoveredPhones = Array.from(new Set(pages.flatMap((p) => p.phones)));
  result.discoveredEmails = Array.from(new Set(pages.flatMap((p) => p.emails)));

  // --- Checks ---------------------------------------------------------------
  const checks = buildChecks({
    homepage,
    pages,
    technologies,
    legacySignals,
    hasRobots: robotsProbe,
    hasSitemap: sitemapProbe,
    hasSsl: result.hasSsl ?? false,
    hasContactPage: result.hasContactPage ?? false,
    hasAboutPage: result.hasAboutPage ?? false,
    hasEcommerce: result.hasEcommerce ?? false,
    hasBooking: result.hasBooking ?? false,
    domain,
    category: opts.businessCategory ?? null,
    homepageHtml,
    redirectedToHttps: (result.hasSsl ?? false) && startUrl.startsWith('http:'),
  });

  const areas = ['SEO', 'MOBILE', 'PERFORMANCE', 'UX', 'CONVERSION', 'TECHNICAL', 'ACCESSIBILITY'] as const;
  const scored = Object.fromEntries(areas.map((a) => [a, scoreArea(checks, a)])) as Record<
    (typeof areas)[number],
    ReturnType<typeof scoreArea>
  >;

  result.scores = {
    seo: scored.SEO.score,
    mobile: scored.MOBILE.score,
    performance: scored.PERFORMANCE.score,
    ux: scored.UX.score,
    conversion: scored.CONVERSION.score,
    technical: scored.TECHNICAL.score,
    accessibility: scored.ACCESSIBILITY.score,
    overall: null,
  };

  // Overall is the weighted mean of the areas we could actually score.
  const weights: Record<string, number> = {
    seo: 0.2,
    mobile: 0.2,
    performance: 0.12,
    ux: 0.15,
    conversion: 0.2,
    technical: 0.08,
    accessibility: 0.05,
  };
  let weightSum = 0;
  let acc = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = result.scores[k as keyof typeof result.scores];
    if (typeof v === 'number') {
      acc += v * w;
      weightSum += w;
    }
  }
  result.scores.overall = weightSum > 0 ? Math.round(acc / weightSum) : null;

  result.unavailableMeasurements = [
    ...areas.flatMap((a) => scored[a].unavailable),
    'lighthouse-core-web-vitals',
    'real-user-performance',
  ];
  result.findings = findingsFrom(checks);

  result.raw = {
    checks: checks.map((c) => ({ id: c.id, area: c.area, outcome: c.outcome, weight: c.weight, evidence: c.evidence })),
    areaScores: scored,
    homepage: {
      title: homepage.title,
      metaDescription: homepage.metaDescription,
      h1: homepage.h1,
      wordCount: homepage.wordCount,
      viewport: homepage.viewportContent,
      technologies: technologies.map((t) => t.name),
    },
    headers: homepageHeaders,
    crawledUrls: pages.map((p) => p.finalUrl),
    auditedAt: new Date().toISOString(),
    crawlerNotes: [
      'Scores are computed from the markup actually fetched.',
      'No Lighthouse / PageSpeed measurement was performed; those metrics are reported as unavailable.',
    ],
  };

  return result;
}

/* -------------------------------------------------------------------------- */

interface CheckContext {
  homepage: PageAnalysis;
  pages: PageAnalysis[];
  technologies: DetectedTechnology[];
  legacySignals: string[];
  hasRobots: boolean;
  hasSitemap: boolean;
  hasSsl: boolean;
  hasContactPage: boolean;
  hasAboutPage: boolean;
  hasEcommerce: boolean;
  hasBooking: boolean;
  domain: string | null;
  category: string | null;
  homepageHtml: string;
  redirectedToHttps: boolean;
}

function buildChecks(ctx: CheckContext): Check[] {
  const { homepage, pages } = ctx;
  const checks: Check[] = [];
  const isAppointmentBusiness = matchesCategoryHints(ctx.category, APPOINTMENT_HINTS);
  const isRetailBusiness = matchesCategoryHints(ctx.category, PRODUCT_SELLING_HINTS);

  /* ----------------------------- SEO ------------------------------------- */
  checks.push(
    check(
      Boolean(homepage.title) && homepage.titleLength >= 10 && homepage.titleLength <= 70,
      'seo.title',
      'SEO',
      3,
      `Title is ${homepage.titleLength} characters`,
      {
        evidence: homepage.title ? `Title is ${homepage.titleLength} characters ("${homepage.title.slice(0, 60)}")` : 'No <title> element',
        titleFa: 'عنوان صفحه نامناسب یا موجود نیست',
        titleEn: 'Page title missing or poorly sized',
        severity: 'HIGH',
      },
    ),
  );
  checks.push(
    check(
      homepage.metaDescriptionLength >= 50 && homepage.metaDescriptionLength <= 170,
      'seo.meta_description',
      'SEO',
      2,
      `Meta description is ${homepage.metaDescriptionLength} characters`,
      {
        evidence: homepage.metaDescription
          ? `Meta description is ${homepage.metaDescriptionLength} characters`
          : 'No meta description',
        titleFa: 'توضیحات متا موجود نیست یا مناسب نیست',
        titleEn: 'Meta description missing or poorly sized',
      },
    ),
  );
  checks.push(
    check(homepage.h1.length === 1, 'seo.single_h1', 'SEO', 2, 'Exactly one H1 on the homepage', {
      evidence: `Homepage has ${homepage.h1.length} H1 headings`,
      titleFa: 'ساختار سرتیتر H1 نادرست است',
      titleEn: 'Incorrect H1 structure',
    }),
  );
  checks.push(
    check(homepage.h2.length >= 2, 'seo.heading_structure', 'SEO', 1, `${homepage.h2.length} H2 headings`, {
      evidence: `Only ${homepage.h2.length} H2 headings found`,
      titleFa: 'ساختار محتوایی صفحه ضعیف است',
      titleEn: 'Weak content structure',
      severity: 'LOW',
    }),
  );
  checks.push(
    check(Boolean(homepage.canonical), 'seo.canonical', 'SEO', 1, 'Canonical URL declared', {
      evidence: 'No canonical URL declared',
      titleFa: 'آدرس canonical تعریف نشده',
      titleEn: 'No canonical URL',
      severity: 'LOW',
    }),
  );
  checks.push(
    check(ctx.hasRobots, 'seo.robots_txt', 'SEO', 1, 'robots.txt is published', {
      evidence: 'No robots.txt found at the site root',
      titleFa: 'فایل robots.txt وجود ندارد',
      titleEn: 'robots.txt missing',
      severity: 'LOW',
    }),
  );
  checks.push(
    check(ctx.hasSitemap, 'seo.sitemap', 'SEO', 2, 'sitemap.xml is published', {
      evidence: 'No sitemap.xml found at the site root',
      titleFa: 'نقشه سایت (sitemap.xml) وجود ندارد',
      titleEn: 'sitemap.xml missing',
    }),
  );
  checks.push(
    check(
      pages.some((p) => p.structuredDataTypes.length > 0),
      'seo.structured_data',
      'SEO',
      2,
      `Structured data found: ${Array.from(new Set(pages.flatMap((p) => p.structuredDataTypes))).join(', ')}`,
      {
        evidence: 'No schema.org structured data found on any crawled page',
        titleFa: 'داده ساختاریافته (Schema) ندارد',
        titleEn: 'No structured data',
      },
    ),
  );
  checks.push(
    check(homepage.wordCount >= 250, 'seo.content_volume', 'SEO', 2, `${homepage.wordCount} words on the homepage`, {
      evidence: `Homepage has only ${homepage.wordCount} words of text`,
      titleFa: 'محتوای متنی صفحه اصلی بسیار کم است',
      titleEn: 'Very little text content on the homepage',
    }),
  );
  checks.push(
    check(pages.length > 1 && homepage.internalLinks >= 5, 'seo.internal_linking', 'SEO', 1, `${homepage.internalLinks} internal links`, {
      evidence: `Only ${homepage.internalLinks} internal links on the homepage`,
      titleFa: 'لینک‌دهی داخلی ضعیف است',
      titleEn: 'Weak internal linking',
      severity: 'LOW',
    }),
  );

  /* ---------------------------- MOBILE ------------------------------------ */
  checks.push(
    check(homepage.hasViewport, 'mobile.viewport', 'MOBILE', 4, `Viewport: ${homepage.viewportContent}`, {
      evidence: 'No <meta name="viewport"> — the page is not designed for mobile screens',
      titleFa: 'صفحه برای موبایل طراحی نشده است',
      titleEn: 'Page is not mobile-ready (no viewport meta)',
      severity: 'HIGH',
    }),
  );
  checks.push(
    check(
      !homepage.hasViewport || /width\s*=\s*device-width/i.test(homepage.viewportContent ?? ''),
      'mobile.viewport_device_width',
      'MOBILE',
      2,
      'Viewport uses width=device-width',
      {
        evidence: `Viewport does not use width=device-width ("${homepage.viewportContent}")`,
        titleFa: 'تنظیمات viewport برای موبایل صحیح نیست',
        titleEn: 'Viewport not set to device width',
      },
    ),
  );
  checks.push(
    check(homepage.fixedWidthHints.length === 0, 'mobile.no_fixed_width', 'MOBILE', 3, 'No large fixed-width layout rules', {
      evidence: `Fixed desktop widths found in CSS: ${homepage.fixedWidthHints.join(', ')}`,
      titleFa: 'چیدمان با عرض ثابت دسکتاپ',
      titleEn: 'Fixed desktop-width layout',
      severity: 'HIGH',
    }),
  );
  const responsiveFramework = ctx.technologies.some((t) => ['Bootstrap', 'Tailwind CSS', 'Next.js', 'Nuxt'].includes(t.name));
  checks.push(
    check(homepage.hasMediaQueries || responsiveFramework, 'mobile.responsive_css', 'MOBILE', 2, 'Responsive CSS detected', {
      evidence: 'No media queries in inline styles and no responsive framework detected',
      titleFa: 'نشانه‌ای از طراحی واکنش‌گرا یافت نشد',
      titleEn: 'No responsive design signals found',
    }),
  );
  checks.push(
    check(!homepage.hasFlash, 'mobile.no_flash', 'MOBILE', 3, 'No Flash content', {
      evidence: 'Page embeds Adobe Flash, which no mobile browser can play',
      titleFa: 'استفاده از فلش (غیرقابل نمایش در موبایل)',
      titleEn: 'Uses Flash (unusable on mobile)',
      severity: 'HIGH',
    }),
  );
  checks.push(
    check(homepage.hasPhoneLink, 'mobile.tap_to_call', 'MOBILE', 2, 'Phone number is a tap-to-call link', {
      evidence: 'No tel: link — a mobile visitor cannot tap the phone number to call',
      titleFa: 'شماره تماس قابل لمس (tap-to-call) نیست',
      titleEn: 'No tap-to-call phone link',
    }),
  );
  // We do not run a mobile emulator, so tap-target sizing and font legibility are honestly
  // reported as not measured rather than guessed at.
  checks.push(unavailable('mobile.tap_target_size', 'MOBILE', 2, 'Requires a rendering engine; not measured'));
  checks.push(unavailable('mobile.font_legibility', 'MOBILE', 1, 'Requires a rendering engine; not measured'));

  /* -------------------------- PERFORMANCE --------------------------------- */
  const avgResponse = averageOf(pages, (p) => p.responseMs);
  if (avgResponse === null) {
    checks.push(unavailable('perf.response_time', 'PERFORMANCE', 3, 'No successful page fetch to time'));
  } else {
    checks.push(
      check(avgResponse < 1500, 'perf.response_time', 'PERFORMANCE', 3, `Average server response ${Math.round(avgResponse)}ms`, {
        evidence: `Average server response time is ${Math.round(avgResponse)}ms across ${pages.length} pages`,
        titleFa: 'زمان پاسخ سرور بالاست',
        titleEn: 'Slow server response',
        severity: avgResponse > 3000 ? 'HIGH' : 'MEDIUM',
      }),
    );
  }
  const homeBytes = homepage.bytes;
  checks.push(
    check(homeBytes < 1_200_000, 'perf.page_weight', 'PERFORMANCE', 2, `Homepage HTML ${Math.round(homeBytes / 1024)}KB`, {
      evidence: `Homepage document is ${Math.round(homeBytes / 1024)}KB before images and scripts`,
      titleFa: 'حجم صفحه اصلی زیاد است',
      titleEn: 'Heavy homepage document',
    }),
  );
  checks.push(
    check(homepage.externalScriptCount <= 20, 'perf.script_count', 'PERFORMANCE', 2, `${homepage.externalScriptCount} external scripts`, {
      evidence: `${homepage.externalScriptCount} external scripts on the homepage`,
      titleFa: 'تعداد اسکریپت‌های خارجی زیاد است',
      titleEn: 'Too many external scripts',
    }),
  );
  checks.push(
    check(
      homepage.imageCount === 0 || homepage.imagesWithoutDimensions / homepage.imageCount < 0.5,
      'perf.image_dimensions',
      'PERFORMANCE',
      1,
      'Most images declare width/height',
      {
        evidence: `${homepage.imagesWithoutDimensions} of ${homepage.imageCount} images have no width/height (causes layout shift)`,
        titleFa: 'ابعاد تصاویر مشخص نشده است',
        titleEn: 'Images missing dimensions',
        severity: 'LOW',
      },
    ),
  );
  checks.push(
    check(homepage.imageCount === 0 || homepage.hasLazyLoading, 'perf.lazy_loading', 'PERFORMANCE', 1, 'Lazy loading in use', {
      evidence: 'No lazy loading on images',
      titleFa: 'بارگذاری تنبل تصاویر فعال نیست',
      titleEn: 'No image lazy loading',
      severity: 'LOW',
    }),
  );
  checks.push(unavailable('perf.core_web_vitals', 'PERFORMANCE', 4, 'LCP/CLS/INP require a real browser measurement; not performed'));

  /* ------------------------------ UX -------------------------------------- */
  checks.push(
    check(homepage.hasLogo, 'ux.logo', 'UX', 2, 'Logo present in the header', {
      evidence: 'No logo image found in the header area',
      titleFa: 'لوگو در سربرگ سایت دیده نمی‌شود',
      titleEn: 'No logo in the header',
    }),
  );
  checks.push(
    check(homepage.hasFavicon, 'ux.favicon', 'UX', 1, 'Favicon declared', {
      evidence: 'No favicon declared',
      titleFa: 'آیکون سایت (favicon) ندارد',
      titleEn: 'No favicon',
      severity: 'LOW',
    }),
  );
  checks.push(
    check(ctx.legacySignals.length === 0, 'ux.modern_markup', 'UX', 3, 'No legacy markup detected', {
      evidence: `Legacy signals: ${ctx.legacySignals.join('; ')}`,
      titleFa: 'ساختار سایت قدیمی است',
      titleEn: 'Outdated site construction',
      severity: 'HIGH',
    }),
  );
  checks.push(
    check(homepage.tableLayoutScore < 0.5, 'ux.no_table_layout', 'UX', 2, 'Layout is not built from tables', {
      evidence: 'Page appears to use tables for layout',
      titleFa: 'چیدمان صفحه با جدول ساخته شده است',
      titleEn: 'Table-based layout',
    }),
  );
  checks.push(
    check(pages.length >= 3, 'ux.site_depth', 'UX', 2, `${pages.length} pages reachable from the homepage`, {
      evidence: `Only ${pages.length} page(s) reachable — the site may be a single page`,
      titleFa: 'سایت تک‌صفحه‌ای یا بسیار کوچک است',
      titleEn: 'Single-page or very small site',
      severity: 'LOW',
    }),
  );
  checks.push(
    check(ctx.hasAboutPage, 'ux.about_page', 'UX', 1, 'About page found', {
      evidence: 'No "about" page found',
      titleFa: 'صفحه درباره ما ندارد',
      titleEn: 'No about page',
      severity: 'LOW',
    }),
  );
  checks.push(
    check(homepage.hasOpenGraph, 'ux.social_preview', 'UX', 1, 'Open Graph tags present', {
      evidence: 'No Open Graph tags — links shared on social media show no preview',
      titleFa: 'پیش‌نمایش اشتراک‌گذاری در شبکه‌های اجتماعی ندارد',
      titleEn: 'No social sharing preview',
      severity: 'LOW',
    }),
  );

  /* -------------------------- CONVERSION ---------------------------------- */
  checks.push(
    check(homepage.ctaCount >= 2, 'conv.cta_present', 'CONVERSION', 4, `${homepage.ctaCount} call-to-action elements`, {
      evidence:
        homepage.ctaCount === 0
          ? 'No recognisable call-to-action on the homepage'
          : `Only ${homepage.ctaCount} call-to-action element on the homepage`,
      titleFa: 'فراخوان اقدام (CTA) روشن ندارد',
      titleEn: 'No clear call to action',
      severity: 'HIGH',
    }),
  );
  checks.push(
    check(pages.some((p) => p.hasContactForm), 'conv.contact_form', 'CONVERSION', 3, 'Contact form found', {
      evidence: 'No contact form found on any crawled page',
      titleFa: 'فرم تماس ندارد',
      titleEn: 'No contact form',
    }),
  );
  checks.push(
    check(ctx.hasContactPage, 'conv.contact_page', 'CONVERSION', 2, 'Contact page found', {
      evidence: 'No dedicated contact page found',
      titleFa: 'صفحه تماس با ما ندارد',
      titleEn: 'No contact page',
    }),
  );
  checks.push(
    check(
      pages.some((p) => p.phones.length > 0) || homepage.hasPhoneLink,
      'conv.phone_visible',
      'CONVERSION',
      3,
      'Phone number published on the site',
      {
        evidence: 'No phone number found anywhere on the crawled pages',
        titleFa: 'شماره تماس روی سایت دیده نمی‌شود',
        titleEn: 'No phone number on the site',
        severity: 'HIGH',
      },
    ),
  );
  checks.push(
    check(homepage.socialLinks.length > 0, 'conv.social_links', 'CONVERSION', 1, `${homepage.socialLinks.length} social links`, {
      evidence: 'No links to social profiles',
      titleFa: 'لینک شبکه‌های اجتماعی ندارد',
      titleEn: 'No social profile links',
      severity: 'LOW',
    }),
  );
  if (isRetailBusiness) {
    checks.push(
      check(ctx.hasEcommerce, 'conv.online_store', 'CONVERSION', 3, 'Online store capability detected', {
        evidence: 'This is a retail-type business but no online ordering or cart was detected',
        titleFa: 'امکان فروش آنلاین ندارد',
        titleEn: 'No online sales capability',
        severity: 'HIGH',
      }),
    );
  }
  if (isAppointmentBusiness) {
    checks.push(
      check(ctx.hasBooking, 'conv.online_booking', 'CONVERSION', 3, 'Online booking detected', {
        evidence: 'This is an appointment-based business but no online booking flow was detected',
        titleFa: 'امکان رزرو یا نوبت‌دهی آنلاین ندارد',
        titleEn: 'No online booking',
        severity: 'HIGH',
      }),
    );
  }
  checks.push(
    check(ctx.pages.some((p) => p.hasAnalytics), 'conv.analytics', 'CONVERSION', 2, 'Analytics tracking installed', {
      evidence: 'No analytics tag found — the business cannot see where its visitors come from',
      titleFa: 'ابزار تحلیل ترافیک نصب نیست',
      titleEn: 'No analytics installed',
    }),
  );

  /* --------------------------- TECHNICAL ---------------------------------- */
  checks.push(
    check(ctx.hasSsl, 'tech.https', 'TECHNICAL', 4, 'Served over HTTPS', {
      evidence: 'The site does not serve valid HTTPS; browsers show a "not secure" warning',
      titleFa: 'گواهی امنیتی (HTTPS) ندارد',
      titleEn: 'No HTTPS',
      severity: 'HIGH',
    }),
  );
  const mixedContent = ctx.hasSsl && /<(?:img|script|link)[^>]+(?:src|href)="http:\/\//i.test(ctx.homepageHtml);
  checks.push(
    check(!mixedContent, 'tech.mixed_content', 'TECHNICAL', 2, 'No mixed content detected', {
      evidence: 'HTTPS page loads resources over plain HTTP (mixed content)',
      titleFa: 'محتوای ناامن (Mixed Content) دارد',
      titleEn: 'Mixed content on an HTTPS page',
    }),
  );
  checks.push(
    check(homepage.status >= 200 && homepage.status < 300, 'tech.http_status', 'TECHNICAL', 3, `Homepage returned ${homepage.status}`, {
      evidence: `Homepage returned HTTP ${homepage.status}`,
      titleFa: 'صفحه اصلی وضعیت HTTP سالم برنمی‌گرداند',
      titleEn: 'Homepage does not return a healthy status',
      severity: 'HIGH',
    }),
  );
  checks.push(
    check(Boolean(homepage.charset) || /charset=/i.test(ctx.homepageHtml), 'tech.charset', 'TECHNICAL', 1, 'Character set declared', {
      evidence: 'No character set declared — Persian text can render incorrectly',
      titleFa: 'کدگذاری کاراکتر تعریف نشده است',
      titleEn: 'No charset declared',
    }),
  );
  checks.push(
    check(Boolean(homepage.lang), 'tech.lang_attribute', 'TECHNICAL', 1, `lang="${homepage.lang}"`, {
      evidence: 'The <html> element declares no language',
      titleFa: 'زبان صفحه تعریف نشده است',
      titleEn: 'No language declared',
      severity: 'LOW',
    }),
  );
  const failedPages = pages.filter((p) => p.status >= 400).length;
  checks.push(
    check(failedPages === 0, 'tech.broken_pages', 'TECHNICAL', 2, 'No broken pages among the crawled sample', {
      evidence: `${failedPages} of ${pages.length} crawled pages returned an error status`,
      titleFa: 'برخی صفحات سایت خطا برمی‌گردانند',
      titleEn: 'Some pages return errors',
    }),
  );

  /* ------------------------- ACCESSIBILITY --------------------------------- */
  const totalImages = pages.reduce((s, p) => s + p.imageCount, 0);
  const missingAlt = pages.reduce((s, p) => s + p.imagesWithoutAlt, 0);
  if (totalImages === 0) {
    checks.push(unavailable('a11y.image_alt', 'ACCESSIBILITY', 3, 'No images on the crawled pages'));
  } else {
    checks.push(
      check(missingAlt / totalImages < 0.3, 'a11y.image_alt', 'ACCESSIBILITY', 3, `${totalImages - missingAlt}/${totalImages} images have alt text`, {
        evidence: `${missingAlt} of ${totalImages} images have no alt text`,
        titleFa: 'متن جایگزین تصاویر ناقص است',
        titleEn: 'Images missing alt text',
      }),
    );
  }
  checks.push(
    check(Boolean(homepage.lang), 'a11y.lang', 'ACCESSIBILITY', 2, 'Language declared', {
      evidence: 'No lang attribute — screen readers cannot pick the right voice',
      titleFa: 'زبان صفحه برای صفحه‌خوان‌ها تعریف نشده',
      titleEn: 'No language for screen readers',
    }),
  );
  checks.push(
    check(homepage.h1.length >= 1, 'a11y.heading_order', 'ACCESSIBILITY', 2, 'Page has a top-level heading', {
      evidence: 'No H1 heading — the page has no announced title for assistive technology',
      titleFa: 'سرتیتر اصلی صفحه وجود ندارد',
      titleEn: 'No main heading',
    }),
  );
  checks.push(unavailable('a11y.color_contrast', 'ACCESSIBILITY', 3, 'Colour contrast requires rendering; not measured'));
  checks.push(unavailable('a11y.keyboard_navigation', 'ACCESSIBILITY', 2, 'Keyboard navigation requires rendering; not measured'));

  return checks;
}

async function probe(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await httpRequest(url, {
      method: 'GET',
      timeoutMs: 8000,
      retries: 0,
      maxBytes: 200_000,
      providerKey: 'website_crawler',
      signal,
    });
    return res.ok && res.body.trim().length > 0;
  } catch {
    return false;
  }
}

function emptyResult(url: string): AuditResult {
  return {
    url,
    finalUrl: null,
    reachable: false,
    httpStatus: null,
    redirectChain: [],
    scores: {
      seo: null,
      mobile: null,
      performance: null,
      ux: null,
      conversion: null,
      technical: null,
      accessibility: null,
      overall: null,
    },
    unavailableMeasurements: [],
    findings: [],
    technologies: [],
    legacySignals: [],
    pages: [],
    pagesCrawled: 0,
    totalBytes: 0,
    responseMs: null,
    hasSsl: null,
    hasViewport: null,
    hasContactForm: null,
    hasContactPage: null,
    hasAboutPage: null,
    hasBlog: null,
    hasEcommerce: null,
    hasBooking: null,
    hasAnalytics: null,
    hasFavicon: null,
    hasLogo: null,
    hasSitemap: null,
    hasRobots: null,
    hasStructuredData: null,
    socialLinks: [],
    discoveredPhones: [],
    discoveredEmails: [],
    raw: {},
    error: null,
    blockedByRobots: false,
  };
}

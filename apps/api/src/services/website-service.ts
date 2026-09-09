import { createHash } from 'node:crypto';
import { extractDomain } from '@baimar/shared';
import type { Lead, Prisma, WebsiteAudit } from '@prisma/client';
import { auditWebsite, AUDIT_ENGINE_VERSION } from '../audit/engine';
import { browserAuditAvailability, runBrowserAudit } from '../audit/browser';
import { discoverWebsite } from '../crawler/discover';
import { loadEnv } from '../config/env';
import { prisma } from '../lib/prisma';
import { jobLogger } from '../lib/logger';
import { trackUsage } from '../lib/provider-usage';
import { getCrawlerSettings } from '../lib/settings';
import { withLock } from '../lib/lock';
import { activeSearchProviders, websiteProvider } from '../providers/registry';

/**
 * Website discovery and auditing for a lead.
 *
 * Both operations are recorded on the lead itself, including the negative outcome:
 * "no website found" is a conclusion the sales team acts on, so it is stored explicitly
 * with the evidence that produced it.
 */

export interface DiscoveryOutcome {
  status: Lead['websiteStatus'];
  url: string | null;
  evidence: string;
  changed: boolean;
}

export async function discoverWebsiteForLead(leadId: string, opts: { force?: boolean } = {}): Promise<DiscoveryOutcome> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  if (lead.websiteDomain && lead.websiteStatus === 'ACTIVE' && !opts.force) {
    return { status: lead.websiteStatus, url: lead.website, evidence: 'Website already verified', changed: false };
  }

  const searchProviders = await activeSearchProviders();
  const result = await discoverWebsite(
    {
      businessName: lead.businessName,
      city: lead.city,
      province: lead.province,
      address: lead.address,
      phone: lead.normalizedPhone,
      extraPhones: lead.extraPhones,
      instagramUrl: lead.instagramUrl,
      telegramUrl: lead.telegramUrl,
      category: lead.category,
    },
    { searchProviders, website: websiteProvider() },
  );

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      website: result.url ?? lead.website,
      websiteDomain: result.domain ?? lead.websiteDomain,
      websiteStatus: result.status,
      websiteCheckedAt: new Date(),
      // The confidence and its per-signal breakdown are stored so the lead page can
      // answer "why do you think this is their website?" without re-running discovery.
      websiteMatchConfidence: result.matchConfidence,
      websiteMatchReasons: {
        signals: result.matchSignals,
        reasons: result.matchReasons,
        suggestions: result.suggestions,
        method: result.method,
        searchProvider: result.searchProviderUsed,
      } as unknown as Prisma.InputJsonValue,
      websiteMatchedBy: result.searchProviderUsed ?? (result.method === 'domain-probe' ? 'domain_probe' : null),
    },
  });

  await prisma.salesActivity.create({
    data: {
      leadId,
      type: 'SYSTEM',
      title: result.url
        ? `وب‌سایت پیدا شد (اطمینان ${result.matchConfidence ?? '—'}٪)`
        : 'وب‌سایتی یافت نشد',
      body: result.evidence || (result.note ?? ''),
      metadata: {
        method: result.method,
        confidence: result.confidence,
        matchConfidence: result.matchConfidence,
        matchReasons: result.matchReasons,
        suggestions: result.suggestions,
        candidatesConsidered: result.candidatesConsidered,
        searchProvider: result.searchProviderUsed,
      },
    },
  });

  return { status: result.status, url: result.url, evidence: result.evidence, changed: true };
}

export interface AuditOutcome {
  audit: WebsiteAudit | null;
  skipped?: string;
}

export async function auditLeadWebsite(leadId: string, opts: { force?: boolean } = {}): Promise<AuditOutcome> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  if (!lead.website && !lead.websiteDomain) {
    return { audit: null, skipped: 'This lead has no website to audit.' };
  }

  const domain = lead.websiteDomain ?? extractDomain(lead.website ?? '') ?? leadId;

  // Two leads can share a website — a chain with two branches, a franchise, a group of
  // clinics under one site. Without this lock both pipelines would crawl the same pages
  // at the same time: twice the load on somebody else's server, and two audit rows that
  // disagree because the site changed in between.
  const outcome = await withLock(`audit:domain:${domain}`, 15 * 60, () => runAudit(lead, opts));
  if (!outcome.ran) {
    const existing = await prisma.websiteAudit.findFirst({ where: { leadId }, orderBy: { createdAt: 'desc' } });
    return { audit: existing, skipped: `An audit of ${domain} is already running; this one was skipped.` };
  }
  return outcome.result;
}

/**
 * Decide whether a stored audit is still good enough to reuse.
 *
 * Re-crawling a site that has not changed costs bandwidth, annoys the site owner and
 * produces an identical result — but a stale audit is worse: the salesperson would open
 * a call with a fact about a website that has since been redesigned. So freshness is
 * tied to how much the answer matters: a hot lead is refreshed sooner than a cold one,
 * and any change to the audit engine invalidates every previous row.
 */
export async function auditCacheDecision(
  lead: Lead,
  force: boolean,
): Promise<{ reuse: WebsiteAudit | null; reason: string }> {
  if (force) return { reuse: null, reason: 'forced re-audit requested' };

  const latest = await prisma.websiteAudit.findFirst({ where: { leadId: lead.id }, orderBy: { createdAt: 'desc' } });
  if (!latest) return { reuse: null, reason: 'no previous audit' };

  if (latest.engineVersion !== AUDIT_ENGINE_VERSION) {
    return { reuse: null, reason: `audit engine changed (${latest.engineVersion} -> ${AUDIT_ENGINE_VERSION})` };
  }
  if (!latest.reachable) return { reuse: null, reason: 'previous audit could not reach the site' };

  const env = loadEnv();
  const ttlDays = lead.leadTemperature === 'HOT' ? env.AUDIT_TTL_DAYS_HOT : env.AUDIT_TTL_DAYS;
  const ageMs = Date.now() - latest.createdAt.getTime();
  const ttlMs = ttlDays * 24 * 3600 * 1000;

  if (ageMs < ttlMs) {
    const ageDays = Math.floor(ageMs / (24 * 3600 * 1000));
    return { reuse: latest, reason: `audit is ${ageDays} day(s) old; the limit for this lead is ${ttlDays}` };
  }
  return { reuse: null, reason: `audit is older than ${ttlDays} days` };
}

async function runAudit(lead: Lead, opts: { force?: boolean }): Promise<AuditOutcome> {
  const leadId = lead.id;
  const log = jobLogger({ leadId, jobName: 'audit_website' });

  const cache = await auditCacheDecision(lead, Boolean(opts.force));
  if (cache.reuse) {
    log.info({ auditId: cache.reuse.id, reason: cache.reason }, 'reusing cached audit');
    return { audit: cache.reuse, skipped: `Reusing the stored audit — ${cache.reason}. Pass force to re-run.` };
  }

  const url = lead.website ?? `https://${lead.websiteDomain}`;
  const result = await auditWebsite(url, websiteProvider(), { businessCategory: lead.category });

  await trackUsage({
    providerKey: 'website_crawler',
    kind: 'WEBSITE',
    requests: Math.max(1, result.pagesCrawled),
    failures: result.reachable ? 0 : 1,
    bytesFetched: result.totalBytes,
  });

  const audit = await prisma.websiteAudit.create({
    data: {
      leadId,
      url,
      finalUrl: result.finalUrl,
      reachable: result.reachable,
      httpStatus: result.httpStatus,
      redirectChain: result.redirectChain,
      raw: result.raw as Prisma.InputJsonValue,
      seoScore: result.scores.seo,
      mobileScore: result.scores.mobile,
      performanceScore: result.scores.performance,
      uxScore: result.scores.ux,
      conversionScore: result.scores.conversion,
      technicalScore: result.scores.technical,
      accessibilityScore: result.scores.accessibility,
      overallScore: result.scores.overall,
      unavailable: result.unavailableMeasurements,
      findings: result.findings as unknown as Prisma.InputJsonValue,
      technologies: result.technologies as unknown as Prisma.InputJsonValue,
      pagesCrawled: result.pagesCrawled,
      totalBytes: result.totalBytes,
      responseMs: result.responseMs,
      hasSsl: result.hasSsl,
      hasViewport: result.hasViewport,
      hasContactForm: result.hasContactForm,
      hasContactPage: result.hasContactPage,
      hasAboutPage: result.hasAboutPage,
      hasBlog: result.hasBlog,
      hasEcommerce: result.hasEcommerce,
      hasBooking: result.hasBooking,
      hasAnalytics: result.hasAnalytics,
      hasFavicon: result.hasFavicon,
      hasLogo: result.hasLogo,
      hasSitemap: result.hasSitemap,
      hasRobots: result.hasRobots,
      hasStructuredData: result.hasStructuredData,
      socialLinks: result.socialLinks,
      discoveredPhones: result.discoveredPhones,
      discoveredEmails: result.discoveredEmails,
      error: result.error,
      engineVersion: AUDIT_ENGINE_VERSION,
      // Hash of what was actually read. When a later crawl produces the same hash the
      // site has not changed, so the previous findings still hold.
      contentHash: contentHashOf(result),
      method: 'HTTP',
      pages: {
        create: result.pages.slice(0, 20).map((p) => ({
          url: p.finalUrl,
          httpStatus: p.status,
          title: p.title,
          metaDescription: p.metaDescription,
          h1: p.h1,
          h2: p.h2.slice(0, 10),
          canonical: p.canonical,
          wordCount: p.wordCount,
          bytes: p.bytes,
          responseMs: p.responseMs,
          hasForm: p.formCount > 0,
          imageCount: p.imageCount,
          imagesWithoutAlt: p.imagesWithoutAlt,
          internalLinks: p.internalLinks,
          externalLinks: p.externalLinks,
          role: p.role,
        })),
      },
    },
  });

  // ---------------------------------------------------------------------
  // Optional browser layer.
  //
  // Runs only when it is switched on AND Playwright is installed. When it does not run,
  // a BrowserAudit row is still written with status NOT_AVAILABLE and every metric null,
  // so the UI can say "not measured" and explain why — rather than leaving the reader to
  // guess whether the site simply scored zero.
  // ---------------------------------------------------------------------
  const availability = await browserAuditAvailability();
  const browserUrl = result.finalUrl ?? url;
  const browser = availability.available
    ? await runBrowserAudit(browserUrl)
    : null;

  await prisma.browserAudit
    .create({
      data: {
        auditId: audit.id,
        leadId,
        url: browserUrl,
        status: browser?.status ?? 'NOT_AVAILABLE',
        unavailableReason: browser?.unavailableReason ?? availability.reason,
        lcpMs: browser?.lcpMs ?? null,
        cls: browser?.cls ?? null,
        inpMs: browser?.inpMs ?? null,
        fcpMs: browser?.fcpMs ?? null,
        ttfbMs: browser?.ttfbMs ?? null,
        domContentLoadedMs: browser?.domContentLoadedMs ?? null,
        loadEventMs: browser?.loadEventMs ?? null,
        viewportWidth: browser?.viewportWidth ?? null,
        viewportHeight: browser?.viewportHeight ?? null,
        fitsMobileViewport: browser?.fitsMobileViewport ?? null,
        horizontalOverflowPx: browser?.horizontalOverflowPx ?? null,
        smallestFontPx: browser?.smallestFontPx ?? null,
        smallTapTargets: browser?.smallTapTargets ?? null,
        consoleErrors: (browser?.consoleErrors ?? []) as unknown as Prisma.InputJsonValue,
        failedRequests: (browser?.failedRequests ?? []) as unknown as Prisma.InputJsonValue,
        requestCount: browser?.requestCount ?? null,
        transferredBytes: browser?.transferredBytes ?? null,
        browserName: browser?.browserName ?? null,
        browserVersion: browser?.browserVersion ?? null,
        durationMs: browser?.durationMs ?? null,
      },
    })
    .catch((err) => {
      jobLogger({ leadId, jobName: 'audit_website' }).warn({ err: String(err) }, 'could not store the browser audit row');
    });

  // Fold what the crawl learned back into the lead record.
  const leadUpdate: Prisma.LeadUpdateInput = { websiteCheckedAt: new Date(), lastCrawledAt: new Date() };
  if (result.reachable) {
    leadUpdate.websiteStatus = isParked(result) ? 'PARKED' : 'ACTIVE';
    if (result.finalUrl) {
      leadUpdate.website = result.finalUrl;
      leadUpdate.websiteDomain = extractDomain(result.finalUrl);
    }
  } else if (lead.websiteDomain) {
    leadUpdate.websiteStatus = 'BROKEN';
  }

  // Contact details found on the site are the most authoritative version we have.
  if (!lead.normalizedPhone && result.discoveredPhones.length) {
    leadUpdate.normalizedPhone = result.discoveredPhones[0];
    leadUpdate.originalPhone = lead.originalPhone ?? result.discoveredPhones[0];
  }
  if (!lead.email && result.discoveredEmails.length) leadUpdate.email = result.discoveredEmails[0];
  for (const link of result.socialLinks) {
    if (!lead.instagramUrl && /instagram\.com/i.test(link)) leadUpdate.instagramUrl = link;
    if (!lead.telegramUrl && /(t\.me|telegram\.me)/i.test(link)) leadUpdate.telegramUrl = link;
    if (!lead.linkedinUrl && /linkedin\.com/i.test(link)) leadUpdate.linkedinUrl = link;
    if (!lead.whatsappUrl && /(wa\.me|whatsapp)/i.test(link)) leadUpdate.whatsappUrl = link;
    if (!lead.facebookUrl && /facebook\.com/i.test(link)) leadUpdate.facebookUrl = link;
    if (!lead.aparatUrl && /aparat\.com/i.test(link)) leadUpdate.aparatUrl = link;
  }

  await prisma.lead.update({ where: { id: leadId }, data: leadUpdate });

  // Record the social profiles we found, with their source.
  for (const link of result.socialLinks.slice(0, 10)) {
    const platform = platformOf(link);
    if (!platform) continue;
    await prisma.socialSignal
      .upsert({
        where: { leadId_platform_url: { leadId, platform, url: link } },
        create: { leadId, platform, url: link, source: 'Business website', sourceUrl: result.finalUrl ?? url },
        update: { observedAt: new Date() },
      })
      .catch(() => undefined);
  }

  return { audit };
}

/** A parked domain has a page but essentially no content and no navigation. */
function isParked(result: Awaited<ReturnType<typeof auditWebsite>>): boolean {
  const home = result.pages[0];
  if (!home) return false;
  return home.wordCount < 40 && home.internalLinks < 2 && home.formCount === 0;
}

function platformOf(url: string): string | null {
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/(t\.me|telegram\.me)/i.test(url)) return 'telegram';
  if (/linkedin\.com/i.test(url)) return 'linkedin';
  if (/(wa\.me|whatsapp)/i.test(url)) return 'whatsapp';
  if (/facebook\.com/i.test(url)) return 'facebook';
  if (/aparat\.com/i.test(url)) return 'aparat';
  if (/youtube\.com/i.test(url)) return 'youtube';
  if (/(twitter\.com|x\.com)/i.test(url)) return 'twitter';
  return null;
}


/**
 * Fingerprint of the crawled content.
 *
 * Built from the page URLs, titles and word counts rather than the raw HTML: a site that
 * prints the current date, a session id or a rotating banner would produce a different
 * hash on every crawl and defeat the whole point of the cache, while a genuine redesign
 * changes titles and structure and is caught.
 */
function contentHashOf(result: Awaited<ReturnType<typeof auditWebsite>>): string {
  const material = result.pages
    .map((p) => `${p.finalUrl}|${p.title ?? ''}|${p.wordCount}|${p.h1.join('~')}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

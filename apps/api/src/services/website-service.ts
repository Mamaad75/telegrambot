import { extractDomain } from '@baimar/shared';
import type { Lead, Prisma, WebsiteAudit } from '@prisma/client';
import { auditWebsite } from '../audit/engine';
import { discoverWebsite } from '../crawler/discover';
import { prisma } from '../lib/prisma';
import { trackUsage } from '../lib/provider-usage';
import { getCrawlerSettings } from '../lib/settings';
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
      phone: lead.normalizedPhone,
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
    },
  });

  await prisma.salesActivity.create({
    data: {
      leadId,
      type: 'SYSTEM',
      title: result.url ? 'وب‌سایت پیدا شد' : 'وب‌سایتی یافت نشد',
      body: result.evidence || (result.note ?? ''),
      metadata: {
        method: result.method,
        confidence: result.confidence,
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
  const settings = await getCrawlerSettings();

  if (!lead.website && !lead.websiteDomain) {
    return { audit: null, skipped: 'This lead has no website to audit.' };
  }

  if (!opts.force) {
    const recent = await prisma.websiteAudit.findFirst({
      where: { leadId, createdAt: { gte: new Date(Date.now() - settings.reauditAfterHours * 3600 * 1000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return { audit: recent, skipped: 'A recent audit already exists; pass force to re-run.' };
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

  // Fold what the crawl learned back into the lead record.
  const leadUpdate: Prisma.LeadUpdateInput = { websiteCheckedAt: new Date() };
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

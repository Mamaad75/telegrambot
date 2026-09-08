import {
  APPOINTMENT_HINTS,
  PRODUCT_SELLING_HINTS,
  SCORING_SIGNAL_META,
  matchesCategoryHints,
  type Confidence,
  type ScoringConfig,
  type ScoringSignal,
} from '@baimar/shared';
import type { Lead, WebsiteAudit } from '@prisma/client';

/**
 * Signal extraction.
 *
 * Turns the raw facts we hold about a lead (its record plus its most recent website audit)
 * into the boolean signals the scoring and opportunity engines consume. Every signal
 * carries the evidence that produced it, so the score can always be explained to the
 * salesperson — and to the business owner, if they ask.
 *
 * A signal that cannot be determined is simply absent. It is never defaulted to `true`.
 */

export interface SignalValue {
  signal: ScoringSignal;
  value: boolean;
  evidence: string;
  confidence: Confidence;
}

export type SignalMap = Partial<Record<ScoringSignal, SignalValue>>;

export interface SignalContext {
  lead: Lead;
  audit: WebsiteAudit | null;
  config: ScoringConfig;
  /** Set when the market engine found strong demand for this lead's likely service. */
  marketDemandMatch?: { matched: boolean; evidence: string };
  businessValueTier?: string | null;
}

export function extractSignals(ctx: SignalContext): SignalMap {
  const { lead, audit, config } = ctx;
  const signals: SignalMap = {};

  const set = (signal: ScoringSignal, value: boolean, evidence: string, confidence: Confidence = 'FACT') => {
    signals[signal] = { signal, value, evidence, confidence };
  };

  /* ---------------------------- Web presence ----------------------------- */
  const hasInstagram = Boolean(lead.instagramUrl);
  const hasAnySocial = hasInstagram || Boolean(lead.telegramUrl) || Boolean(lead.linkedinUrl) || Boolean(lead.facebookUrl);

  switch (lead.websiteStatus) {
    case 'NO_WEBSITE':
      set('NO_WEBSITE', true, 'No website was found for this business after discovery.', 'CALCULATED');
      if (hasAnySocial) {
        set(
          'SOCIAL_ONLY_PRESENCE',
          true,
          `Active on social media (${[lead.instagramUrl && 'Instagram', lead.telegramUrl && 'Telegram'].filter(Boolean).join(', ')}) but has no website.`,
          'CALCULATED',
        );
      }
      break;
    case 'BROKEN':
      set('WEBSITE_BROKEN', true, audit?.error ?? 'The website did not respond during the audit.', 'FACT');
      break;
    case 'PARKED':
      set('WEBSITE_PARKED', true, 'The domain resolves to a placeholder/parking page.', 'FACT');
      break;
    case 'SOCIAL_ONLY':
      set('SOCIAL_ONLY_PRESENCE', true, 'The business operates through social media only.', 'CALCULATED');
      set('NO_WEBSITE', true, 'No website of their own.', 'CALCULATED');
      break;
    default:
      break;
  }

  if (hasInstagram) {
    set('ACTIVE_INSTAGRAM', true, `Public Instagram profile: ${lead.instagramUrl}`, 'FACT');
  }

  // Capability gaps only count where the capability would actually be used: a missing
  // online store is a sales signal for a shop, not for an accountant.
  const categoryText = [lead.category, lead.subcategory, lead.businessType].filter(Boolean).join(' ');
  const sellsProducts = (lead.products?.length ?? 0) > 0 || matchesCategoryHints(categoryText, PRODUCT_SELLING_HINTS);
  const takesAppointments = matchesCategoryHints(categoryText, APPOINTMENT_HINTS);

  // With no website there is definitionally no online store and no online booking. This is
  // a deduction from an observed fact, not an assumption, so it is marked CALCULATED.
  if (signals.NO_WEBSITE?.value) {
    if (sellsProducts) {
      set('NO_ONLINE_STORE', true, 'The business sells products but has no website, so it has no online sales capability.', 'CALCULATED');
    }
    if (takesAppointments) {
      set('NO_ONLINE_BOOKING', true, 'The business works by appointment but has no website, so it has no online booking.', 'CALCULATED');
    }
  }

  /* ------------------------------- Reviews ------------------------------- */
  if (typeof lead.reviewCount === 'number') {
    if (lead.reviewCount >= config.audit.highReviewCount) {
      set('HIGH_REVIEW_COUNT', true, `${lead.reviewCount} public reviews.`, 'FACT');
    }
  }
  if (typeof lead.reviewRating === 'number' && lead.reviewRating >= 4) {
    set('HIGH_REVIEW_RATING', true, `Public rating ${lead.reviewRating.toFixed(1)}/5.`, 'FACT');
  }

  /* ------------------------------ Category ------------------------------- */
  const categoryHaystack = [lead.category, lead.subcategory, lead.businessType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const matchedCategory = config.strongCategories.find((c) => categoryHaystack.includes(c.toLowerCase()));
  if (matchedCategory) {
    set('STRONG_COMMERCIAL_CATEGORY', true, `Category "${matchedCategory}" is on the high-intent list.`, 'CALCULATED');
  }

  if (ctx.businessValueTier === 'HIGH' || ctx.businessValueTier === 'VERY_HIGH') {
    set('HIGH_BUSINESS_POTENTIAL', true, `Business value assessed as ${ctx.businessValueTier}.`, 'CALCULATED');
  }

  if (ctx.marketDemandMatch?.matched) {
    set('MARKET_DEMAND_MATCH', true, ctx.marketDemandMatch.evidence, 'CALCULATED');
  }

  /* -------------------------- Website audit ------------------------------ */
  if (!audit || !audit.reachable) return signals;

  const s = audit;
  const isSet = (v: number | null): v is number => typeof v === 'number';

  if (isSet(s.mobileScore) && s.mobileScore < ctx.config.audit.mobile) {
    set('POOR_MOBILE_UX', true, `Mobile score ${s.mobileScore}/100 (threshold ${ctx.config.audit.mobile}).`, 'CALCULATED');
  }
  if (isSet(s.performanceScore) && s.performanceScore < ctx.config.audit.performance) {
    set(
      'POOR_PERFORMANCE',
      true,
      `Performance score ${s.performanceScore}/100${s.responseMs ? `, average response ${s.responseMs}ms` : ''}.`,
      'CALCULATED',
    );
  }
  if (isSet(s.seoScore) && s.seoScore < ctx.config.audit.seo) {
    set('WEAK_SEO', true, `SEO score ${s.seoScore}/100 (threshold ${ctx.config.audit.seo}).`, 'CALCULATED');
  }
  if (isSet(s.conversionScore) && s.conversionScore < ctx.config.audit.conversion) {
    set('WEAK_CTA', true, `Conversion score ${s.conversionScore}/100 — no clear path from visitor to enquiry.`, 'CALCULATED');
  }
  if (s.hasContactForm === false) {
    set('NO_CONTACT_FORM', true, 'No contact form was found on any crawled page.', 'FACT');
  }
  if (s.hasSsl === false) {
    set('NO_SSL', true, 'The site does not serve valid HTTPS.', 'FACT');
  }
  if (s.hasStructuredData === false && s.hasLogo === false) {
    set('WEAK_BRANDING', true, 'No logo in the header and no brand structured data.', 'CALCULATED');
  } else if (s.hasFavicon === false && s.hasLogo === false) {
    set('WEAK_BRANDING', true, 'Neither a logo nor a favicon was found.', 'CALCULATED');
  }

  // "Outdated" is only claimed when the markup itself proves it.
  const legacy = Array.isArray((s.raw as { legacySignals?: unknown })?.legacySignals)
    ? ((s.raw as { legacySignals: string[] }).legacySignals ?? [])
    : [];
  const rawObj = (s.raw ?? {}) as Record<string, unknown>;
  const legacyFromRaw = Array.isArray(rawObj.legacySignals) ? (rawObj.legacySignals as string[]) : legacy;
  if (legacyFromRaw.length > 0) {
    set('OUTDATED_WEBSITE', true, `Legacy construction detected: ${legacyFromRaw.join('; ')}.`, 'FACT');
  } else if (s.hasViewport === false) {
    set('OUTDATED_WEBSITE', true, 'The page has no viewport meta tag — it predates mobile-first design.', 'FACT');
  }

  if (s.hasEcommerce === false && sellsProducts) {
    set('NO_ONLINE_STORE', true, 'The business sells products, but no cart, checkout or payment flow was detected on the site.', 'FACT');
  }
  if (s.hasBooking === false && takesAppointments) {
    set('NO_ONLINE_BOOKING', true, 'The business works by appointment, but no online booking flow was detected on the site.', 'FACT');
  }
  if (s.hasContactPage === false || s.hasAboutPage === false) {
    const missing = [s.hasContactPage === false && 'contact page', s.hasAboutPage === false && 'about page']
      .filter(Boolean)
      .join(' and ');
    set('MISSING_BUSINESS_INFO', true, `Missing ${missing}.`, 'FACT');
  }

  const services = lead.services ?? [];
  if (services.length >= 4 && s.pagesCrawled <= 3) {
    set(
      'POOR_CONTENT_STRUCTURE',
      true,
      `${services.length} services advertised but only ${s.pagesCrawled} pages found — no dedicated page per service.`,
      'CALCULATED',
    );
  }

  /* --------------------- Counter-signals (reduce score) ------------------- */
  const modern =
    s.hasViewport === true &&
    legacyFromRaw.length === 0 &&
    isSet(s.mobileScore) &&
    s.mobileScore >= 75 &&
    isSet(s.overallScore) &&
    s.overallScore >= 70;
  if (modern) {
    set('MODERN_WEBSITE', true, `Recent, responsive site (overall audit score ${s.overallScore}/100).`, 'CALCULATED');
  }
  if (isSet(s.conversionScore) && s.conversionScore >= 75) {
    set('STRONG_CONVERSION_PATH', true, `Conversion score ${s.conversionScore}/100 — contact paths already work well.`, 'CALCULATED');
  }

  return signals;
}

/** Signals that are true, as a plain list — the input format the opportunity engine wants. */
export function activeSignalKeys(signals: SignalMap): ScoringSignal[] {
  return (Object.keys(signals) as ScoringSignal[]).filter((k) => signals[k]?.value === true);
}

/** Persian label for a signal, for the UI. */
export function signalLabelFa(signal: ScoringSignal): string {
  return SCORING_SIGNAL_META[signal]?.labelFa ?? signal;
}

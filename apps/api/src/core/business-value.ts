import {
  businessValueTierFor,
  type BusinessValueConfig,
  type BusinessValueTier,
} from '@baimar/shared';
import type { Lead, WebsiteAudit } from '@prisma/client';

/**
 * Business value.
 *
 * Deliberately distinct from the lead score: this estimates *commercial attractiveness*
 * from public signals only. It is never presented as revenue, headcount or turnover,
 * because we have no legitimate source for any of those. The output is one of four coarse
 * tiers plus the list of reasons that produced it.
 */

export interface BusinessValueReason {
  factor: string;
  points: number;
  labelFa: string;
  evidence: string;
}

export interface BusinessValueResult {
  score: number;
  tier: BusinessValueTier;
  reasons: BusinessValueReason[];
  /** What we could not assess, so the UI can say so instead of implying a low value. */
  unknownFactors: string[];
  sizeEstimate: string | null;
}

export function assessBusinessValue(
  lead: Lead,
  audit: WebsiteAudit | null,
  config: BusinessValueConfig,
): BusinessValueResult {
  const reasons: BusinessValueReason[] = [];
  const unknownFactors: string[] = [];
  let score = 0;

  const add = (factor: string, points: number, labelFa: string, evidence: string) => {
    if (points === 0) return;
    score += points;
    reasons.push({ factor, points, labelFa, evidence });
  };

  /* ----------------------------- Category -------------------------------- */
  const haystack = [lead.category, lead.subcategory, lead.businessType].filter(Boolean).join(' ').toLowerCase();
  let bestCategoryPoints = 0;
  let bestCategoryKey: string | null = null;
  for (const [key, points] of Object.entries(config.categoryPoints)) {
    if (haystack.includes(key.toLowerCase()) && points > bestCategoryPoints) {
      bestCategoryPoints = points;
      bestCategoryKey = key;
    }
  }
  if (bestCategoryKey) {
    add('category', bestCategoryPoints, 'دسته کسب‌وکار', `Category "${bestCategoryKey}" typically carries a higher project value.`);
  } else if (!haystack) {
    unknownFactors.push('category');
  }

  /* ------------------------------ Reviews -------------------------------- */
  if (typeof lead.reviewCount === 'number') {
    const tier = config.reviewCountTiers.find((t) => lead.reviewCount! >= t.min);
    if (tier) {
      add('reviews', tier.points, 'حجم نظرات عمومی', `${lead.reviewCount} public reviews indicate a substantial customer base.`);
    }
  } else {
    unknownFactors.push('reviewCount');
  }

  /* -------------------------- Service breadth ---------------------------- */
  const breadth = (lead.services?.length ?? 0) + (lead.products?.length ?? 0);
  if (breadth > 0) {
    const tier = config.serviceBreadthTiers.find((t) => breadth >= t.min);
    if (tier) {
      add('service_breadth', tier.points, 'تنوع خدمات', `${breadth} distinct services/products advertised.`);
    }
  } else {
    unknownFactors.push('services');
  }

  /* ----------------------------- Presence -------------------------------- */
  const p = config.presencePoints;
  if (lead.websiteDomain && ['ACTIVE', 'NOT_VERIFIED'].includes(lead.websiteStatus)) {
    add('has_website', p.hasWebsite, 'داشتن وب‌سایت', `The business already invests in a website (${lead.websiteDomain}).`);
  }
  if (audit?.hasEcommerce) {
    add('ecommerce', p.hasEcommerce, 'فروش آنلاین فعال', 'The site already sells online, which implies transactional volume.');
  }
  if (audit?.hasBooking) {
    add('booking', p.hasBooking, 'نوبت‌دهی آنلاین', 'The site already runs an online booking flow.');
  }
  if (audit && audit.pagesCrawled >= 6) {
    add('many_pages', p.manyPages, 'سایت پرمحتوا', `${audit.pagesCrawled} pages reachable — a substantial site.`);
  }
  if (lead.instagramUrl || lead.telegramUrl) {
    add('active_social', p.activeSocial, 'حضور فعال اجتماعی', 'Maintains at least one public social channel.');
  }
  if ((lead.extraPhones?.length ?? 0) >= 2) {
    add('multi_line', p.multipleLocations, 'چند خط تماس', `${lead.extraPhones.length + 1} phone lines suggest multiple branches or departments.`);
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const tier = reasons.length === 0 ? 'UNKNOWN' : businessValueTierFor(finalScore, config.tierThresholds);

  return {
    score: finalScore,
    tier,
    reasons: reasons.sort((a, b) => b.points - a.points),
    unknownFactors,
    sizeEstimate: estimateSize(lead, audit),
  };
}

/**
 * A coarse size hint, expressed in words the salesperson can sanity-check, never as a
 * headcount or a revenue figure. Returns null when nothing supports an estimate.
 */
function estimateSize(lead: Lead, audit: WebsiteAudit | null): string | null {
  const signals: string[] = [];
  if ((lead.reviewCount ?? 0) >= 200) signals.push('حجم بالای نظرات عمومی');
  if ((lead.services?.length ?? 0) >= 8) signals.push('تنوع زیاد خدمات');
  if ((audit?.pagesCrawled ?? 0) >= 8) signals.push('سایت گسترده');
  if ((lead.extraPhones?.length ?? 0) >= 2) signals.push('چند خط تماس');

  if (signals.length >= 2) return `بزرگ‌تر از متوسط — بر پایه: ${signals.join('، ')}`;
  if (signals.length === 1) return `متوسط — بر پایه: ${signals[0]}`;
  if ((lead.reviewCount ?? 0) > 0 || audit) return 'کوچک تا متوسط — نشانه‌های عمومی محدود';
  return null;
}

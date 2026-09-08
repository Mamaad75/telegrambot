import type { BusinessValueTier, LeadTemperature } from './enums';

/**
 * Lead scoring configuration.
 *
 * Every weight and threshold here is a *default*. Administrators override them from
 * Settings → Scoring; the engine always reads the effective config from the database.
 */

export const SCORING_SIGNALS = [
  'NO_WEBSITE',
  'WEBSITE_BROKEN',
  'WEBSITE_PARKED',
  'SOCIAL_ONLY_PRESENCE',
  'OUTDATED_WEBSITE',
  'POOR_MOBILE_UX',
  'POOR_PERFORMANCE',
  'WEAK_SEO',
  'WEAK_CTA',
  'NO_CONTACT_FORM',
  'NO_SSL',
  'NO_ONLINE_STORE',
  'NO_ONLINE_BOOKING',
  'WEAK_BRANDING',
  'POOR_CONTENT_STRUCTURE',
  'MISSING_BUSINESS_INFO',
  'ACTIVE_INSTAGRAM',
  'HIGH_REVIEW_COUNT',
  'HIGH_REVIEW_RATING',
  'STRONG_COMMERCIAL_CATEGORY',
  'HIGH_BUSINESS_POTENTIAL',
  'MARKET_DEMAND_MATCH',
  'MODERN_WEBSITE',
  'STRONG_CONVERSION_PATH',
] as const;

export type ScoringSignal = (typeof SCORING_SIGNALS)[number];

export interface SignalMeta {
  labelFa: string;
  labelEn: string;
  /** Positive weights increase the opportunity score, negative ones reduce it. */
  defaultWeight: number;
  /** What has to be observed for this signal to fire. Shown in Settings → Scoring. */
  criterion: string;
}

export const SCORING_SIGNAL_META: Record<ScoringSignal, SignalMeta> = {
  NO_WEBSITE: {
    labelFa: 'بدون وب‌سایت',
    labelEn: 'No website',
    defaultWeight: 25,
    criterion: 'No website could be discovered for the business.',
  },
  WEBSITE_BROKEN: {
    labelFa: 'وب‌سایت خراب',
    labelEn: 'Broken website',
    defaultWeight: 22,
    criterion: 'The website did not respond, or returned a server error.',
  },
  WEBSITE_PARKED: {
    labelFa: 'دامنه پارک‌شده',
    labelEn: 'Parked domain',
    defaultWeight: 20,
    criterion: 'The domain resolves to a parking/placeholder page.',
  },
  SOCIAL_ONLY_PRESENCE: {
    labelFa: 'فقط شبکه اجتماعی',
    labelEn: 'Social only',
    defaultWeight: 18,
    criterion: 'Active social profile but no website of their own.',
  },
  OUTDATED_WEBSITE: {
    labelFa: 'وب‌سایت قدیمی',
    labelEn: 'Outdated website',
    defaultWeight: 15,
    criterion: 'Legacy markup, no viewport, table layout, Flash, or very old platform.',
  },
  POOR_MOBILE_UX: {
    labelFa: 'تجربه موبایل ضعیف',
    labelEn: 'Poor mobile UX',
    defaultWeight: 15,
    criterion: 'Mobile score below the configured mobile threshold.',
  },
  POOR_PERFORMANCE: {
    labelFa: 'کارایی ضعیف',
    labelEn: 'Poor performance',
    defaultWeight: 10,
    criterion: 'Measured page weight / response time above the configured budget.',
  },
  WEAK_SEO: {
    labelFa: 'سئوی ضعیف',
    labelEn: 'Weak SEO',
    defaultWeight: 10,
    criterion: 'SEO score below the configured SEO threshold.',
  },
  WEAK_CTA: {
    labelFa: 'فراخوان ضعیف',
    labelEn: 'Weak call to action',
    defaultWeight: 8,
    criterion: 'No prominent call-to-action found above the fold.',
  },
  NO_CONTACT_FORM: {
    labelFa: 'بدون فرم تماس',
    labelEn: 'No contact form',
    defaultWeight: 5,
    criterion: 'No form element and no contact page were found.',
  },
  NO_SSL: {
    labelFa: 'بدون SSL',
    labelEn: 'No HTTPS',
    defaultWeight: 8,
    criterion: 'The site does not serve valid HTTPS.',
  },
  NO_ONLINE_STORE: {
    labelFa: 'بدون فروشگاه آنلاین',
    labelEn: 'No online store',
    defaultWeight: 8,
    criterion: 'Retail-type business with no e-commerce capability detected.',
  },
  NO_ONLINE_BOOKING: {
    labelFa: 'بدون رزرو آنلاین',
    labelEn: 'No online booking',
    defaultWeight: 8,
    criterion: 'Appointment-type business with no booking/reservation flow detected.',
  },
  WEAK_BRANDING: {
    labelFa: 'برندینگ ضعیف',
    labelEn: 'Weak branding',
    defaultWeight: 6,
    criterion: 'No logo, no favicon, or no consistent brand assets found.',
  },
  POOR_CONTENT_STRUCTURE: {
    labelFa: 'ساختار محتوایی ضعیف',
    labelEn: 'Poor content structure',
    defaultWeight: 6,
    criterion: 'Many services but no structured pages, or missing heading hierarchy.',
  },
  MISSING_BUSINESS_INFO: {
    labelFa: 'اطلاعات ناقص کسب‌وکار',
    labelEn: 'Missing business info',
    defaultWeight: 5,
    criterion: 'Address, phone or opening hours missing from the website.',
  },
  ACTIVE_INSTAGRAM: {
    labelFa: 'اینستاگرام فعال',
    labelEn: 'Active Instagram',
    defaultWeight: 5,
    criterion: 'A public Instagram profile is linked from the business data.',
  },
  HIGH_REVIEW_COUNT: {
    labelFa: 'تعداد نظرات بالا',
    labelEn: 'High review count',
    defaultWeight: 5,
    criterion: 'Public review count above the configured threshold.',
  },
  HIGH_REVIEW_RATING: {
    labelFa: 'امتیاز بالا',
    labelEn: 'High rating',
    defaultWeight: 3,
    criterion: 'Public rating at or above 4.0.',
  },
  STRONG_COMMERCIAL_CATEGORY: {
    labelFa: 'دسته تجاری قوی',
    labelEn: 'Strong commercial category',
    defaultWeight: 10,
    criterion: 'Business category is on the high-intent list (clinics, retail, manufacturing…).',
  },
  HIGH_BUSINESS_POTENTIAL: {
    labelFa: 'پتانسیل تجاری بالا',
    labelEn: 'High business potential',
    defaultWeight: 10,
    criterion: 'Business value tier is HIGH or VERY_HIGH.',
  },
  MARKET_DEMAND_MATCH: {
    labelFa: 'هم‌راستا با تقاضای بازار',
    labelEn: 'Matches market demand',
    defaultWeight: 7,
    criterion: 'The recommended service matches a strong market demand signal for this city.',
  },
  MODERN_WEBSITE: {
    labelFa: 'وب‌سایت مدرن',
    labelEn: 'Modern website',
    defaultWeight: -12,
    criterion: 'Recent stack, responsive, good scores — less opportunity for Baimar.',
  },
  STRONG_CONVERSION_PATH: {
    labelFa: 'مسیر تبدیل قوی',
    labelEn: 'Strong conversion path',
    defaultWeight: -8,
    criterion: 'Clear CTAs, forms and contact options already in place.',
  },
};

export type ScoringWeights = Partial<Record<ScoringSignal, number>>;

export const DEFAULT_SCORING_WEIGHTS: Record<ScoringSignal, number> = Object.fromEntries(
  (Object.keys(SCORING_SIGNAL_META) as ScoringSignal[]).map((k) => [k, SCORING_SIGNAL_META[k].defaultWeight]),
) as Record<ScoringSignal, number>;

export interface TemperatureThresholds {
  hot: number;
  warm: number;
  medium: number;
}

export const DEFAULT_TEMPERATURE_THRESHOLDS: TemperatureThresholds = { hot: 80, warm: 65, medium: 45 };

/** Sub-score thresholds that decide whether a "weak X" signal fires. */
export interface AuditThresholds {
  seo: number;
  mobile: number;
  performance: number;
  ux: number;
  conversion: number;
  technical: number;
  highReviewCount: number;
}

export const DEFAULT_AUDIT_THRESHOLDS: AuditThresholds = {
  seo: 60,
  mobile: 60,
  performance: 55,
  ux: 60,
  conversion: 55,
  technical: 60,
  highReviewCount: 30,
};

/**
 * Signals are grouped, and each group's positive contribution is capped.
 *
 * Without caps a single audited website stacks a dozen small findings and pins every
 * audited lead at 100/100, which destroys the ranking the sales team actually needs.
 * Capping keeps the score discriminating: a site with ten problems is worse than one with
 * three, but not ten times worse, and it cannot drown out the presence and potential
 * signals that describe the business itself.
 */
export const SIGNAL_GROUPS = ['PRESENCE', 'WEBSITE_QUALITY', 'CAPABILITY', 'POTENTIAL'] as const;
export type SignalGroup = (typeof SIGNAL_GROUPS)[number];

export const SIGNAL_GROUP_OF: Record<ScoringSignal, SignalGroup | 'COUNTER'> = {
  NO_WEBSITE: 'PRESENCE',
  WEBSITE_BROKEN: 'PRESENCE',
  WEBSITE_PARKED: 'PRESENCE',
  SOCIAL_ONLY_PRESENCE: 'PRESENCE',
  OUTDATED_WEBSITE: 'WEBSITE_QUALITY',
  POOR_MOBILE_UX: 'WEBSITE_QUALITY',
  POOR_PERFORMANCE: 'WEBSITE_QUALITY',
  WEAK_SEO: 'WEBSITE_QUALITY',
  WEAK_CTA: 'WEBSITE_QUALITY',
  NO_CONTACT_FORM: 'WEBSITE_QUALITY',
  NO_SSL: 'WEBSITE_QUALITY',
  WEAK_BRANDING: 'WEBSITE_QUALITY',
  POOR_CONTENT_STRUCTURE: 'WEBSITE_QUALITY',
  MISSING_BUSINESS_INFO: 'WEBSITE_QUALITY',
  NO_ONLINE_STORE: 'CAPABILITY',
  NO_ONLINE_BOOKING: 'CAPABILITY',
  ACTIVE_INSTAGRAM: 'POTENTIAL',
  HIGH_REVIEW_COUNT: 'POTENTIAL',
  HIGH_REVIEW_RATING: 'POTENTIAL',
  STRONG_COMMERCIAL_CATEGORY: 'POTENTIAL',
  HIGH_BUSINESS_POTENTIAL: 'POTENTIAL',
  MARKET_DEMAND_MATCH: 'POTENTIAL',
  // Counter-signals reduce the score and are never capped — a genuinely good website
  // must be able to pull a lead all the way down.
  MODERN_WEBSITE: 'COUNTER',
  STRONG_CONVERSION_PATH: 'COUNTER',
};

export type GroupCaps = Record<SignalGroup, number>;

export const DEFAULT_GROUP_CAPS: GroupCaps = {
  PRESENCE: 30,
  WEBSITE_QUALITY: 45,
  CAPABILITY: 14,
  POTENTIAL: 30,
};

export interface ScoringConfig {
  weights: Record<ScoringSignal, number>;
  thresholds: TemperatureThresholds;
  audit: AuditThresholds;
  /** Maximum positive points each signal group may contribute. */
  groupCaps: GroupCaps;
  /** Categories treated as high commercial intent for Baimar's services. */
  strongCategories: string[];
}

export const DEFAULT_STRONG_CATEGORIES = [
  'dental clinic', 'کلینیک دندانپزشکی', 'دندانپزشکی',
  'beauty clinic', 'کلینیک زیبایی', 'زیبایی',
  'medical clinic', 'کلینیک', 'مطب',
  'restaurant', 'رستوران', 'کافه', 'cafe',
  'retail', 'فروشگاه', 'پوشاک', 'boutique',
  'manufacturer', 'تولیدی', 'صنایع', 'کارخانه',
  'real estate', 'املاک',
  'education', 'آموزشگاه', 'مدرسه',
  'law firm', 'وکالت', 'حقوقی',
  'gym', 'باشگاه', 'fitness',
  'hotel', 'هتل',
  'auto', 'خودرو', 'نمایشگاه اتومبیل',
];

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: DEFAULT_SCORING_WEIGHTS,
  thresholds: DEFAULT_TEMPERATURE_THRESHOLDS,
  audit: DEFAULT_AUDIT_THRESHOLDS,
  groupCaps: DEFAULT_GROUP_CAPS,
  strongCategories: DEFAULT_STRONG_CATEGORIES,
};

export function temperatureFor(score: number, t: TemperatureThresholds = DEFAULT_TEMPERATURE_THRESHOLDS): LeadTemperature {
  if (score >= t.hot) return 'HOT';
  if (score >= t.warm) return 'WARM';
  if (score >= t.medium) return 'MEDIUM';
  return 'LOW';
}

/* -------------------------------------------------------------------------- */
/*  Business value                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Business value is *not* revenue and must never be presented as such. It is a coarse
 * ranking of commercial attractiveness derived only from public signals.
 */
export interface BusinessValueConfig {
  /** Category keyword -> points. Matched against category/subcategory/business type. */
  categoryPoints: Record<string, number>;
  /** Public review count -> points, evaluated as "at least N". */
  reviewCountTiers: Array<{ min: number; points: number }>;
  /** Number of distinct services/products advertised -> points. */
  serviceBreadthTiers: Array<{ min: number; points: number }>;
  /** Points for having a website at all, for multi-branch signals, for e-commerce, etc. */
  presencePoints: {
    hasWebsite: number;
    hasEcommerce: number;
    hasBooking: number;
    multipleLocations: number;
    activeSocial: number;
    manyPages: number;
  };
  /** Score cut-offs for the four tiers. */
  tierThresholds: { veryHigh: number; high: number; medium: number };
}

export const DEFAULT_BUSINESS_VALUE_CONFIG: BusinessValueConfig = {
  categoryPoints: {
    'کلینیک زیبایی': 22,
    'beauty clinic': 22,
    'دندانپزشکی': 22,
    'dental': 22,
    'کلینیک': 18,
    'clinic': 18,
    'بیمارستان': 20,
    'hospital': 20,
    'تولیدی': 20,
    'manufacturer': 20,
    'صنایع': 20,
    'industry': 18,
    'املاک': 16,
    'real estate': 16,
    'هتل': 16,
    'hotel': 16,
    'رستوران': 14,
    'restaurant': 14,
    'فروشگاه': 14,
    'retail': 14,
    'store': 14,
    'آموزشگاه': 12,
    'education': 12,
    'وکالت': 14,
    'law': 14,
    'باشگاه': 10,
    'gym': 10,
    'کافه': 8,
    'cafe': 8,
  },
  reviewCountTiers: [
    { min: 500, points: 22 },
    { min: 200, points: 18 },
    { min: 100, points: 14 },
    { min: 50, points: 10 },
    { min: 20, points: 6 },
    { min: 5, points: 3 },
  ],
  serviceBreadthTiers: [
    { min: 12, points: 12 },
    { min: 6, points: 8 },
    { min: 3, points: 4 },
  ],
  presencePoints: {
    hasWebsite: 6,
    hasEcommerce: 10,
    hasBooking: 6,
    multipleLocations: 10,
    activeSocial: 6,
    manyPages: 8,
  },
  tierThresholds: { veryHigh: 70, high: 50, medium: 30 },
};

export function businessValueTierFor(
  score: number,
  t = DEFAULT_BUSINESS_VALUE_CONFIG.tierThresholds,
): BusinessValueTier {
  if (score >= t.veryHigh) return 'VERY_HIGH';
  if (score >= t.high) return 'HIGH';
  if (score >= t.medium) return 'MEDIUM';
  return 'LOW';
}

export const BUSINESS_VALUE_LABELS: Record<BusinessValueTier, { fa: string; en: string }> = {
  UNKNOWN: { fa: 'نامشخص', en: 'Unknown' },
  LOW: { fa: 'کم', en: 'Low' },
  MEDIUM: { fa: 'متوسط', en: 'Medium' },
  HIGH: { fa: 'بالا', en: 'High' },
  VERY_HIGH: { fa: 'خیلی بالا', en: 'Very high' },
};

export const TEMPERATURE_LABELS: Record<LeadTemperature, { fa: string; en: string }> = {
  HOT: { fa: 'داغ', en: 'Hot' },
  WARM: { fa: 'گرم', en: 'Warm' },
  MEDIUM: { fa: 'متوسط', en: 'Medium' },
  LOW: { fa: 'کم', en: 'Low' },
};

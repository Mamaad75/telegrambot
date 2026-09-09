import type {
  AuditFinding,
  BusinessValueTier,
  ContactStatus,
  DetectedTechnology,
  LeadTemperature,
  SalesBriefContent,
  ScoreContribution,
  WebsiteStatus,
} from '@baimar/shared';

/** Shape of GET /api/leads/:id — kept in one place so every tab agrees on it. */

export interface LeadDetail {
  lead: {
    id: string;
    businessName: string;
    category: string | null;
    subcategory: string | null;
    businessType: string | null;
    city: string | null;
    province: string | null;
    area: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    originalPhone: string | null;
    normalizedPhone: string | null;
    mobile: string | null;
    extraPhones: string[];
    email: string | null;
    website: string | null;
    websiteDomain: string | null;
    websiteStatus: WebsiteStatus;
    websiteCheckedAt: string | null;
    googleMapsUrl: string | null;
    instagramUrl: string | null;
    telegramUrl: string | null;
    linkedinUrl: string | null;
    whatsappUrl: string | null;
    facebookUrl: string | null;
    description: string | null;
    services: string[];
    products: string[];
    openingHours: unknown;
    reviewCount: number | null;
    reviewRating: number | null;
    businessSizeEstimate: string | null;
    businessValueScore: number | null;
    businessValueTier: BusinessValueTier;
    businessValueReasons: {
      score: number;
      tier: string;
      reasons: Array<{ factor: string; points: number; labelFa: string; evidence: string }>;
      unknownFactors: string[];
      sizeEstimate: string | null;
    } | null;
    leadScore: number | null;
    leadTemperature: LeadTemperature | null;
    scoreBreakdown: ScoreContribution[] | null;
    scoredAt: string | null;
    recommendedService: string | null;
    recommendedServiceName: string | null;
    secondaryServices: string[];
    salesAngle: string | null;
    painPoints: string[];
    opportunities: string[];
    decisionMakerName: string | null;
    decisionMakerRole: string | null;
    contactStatus: ContactStatus;
    assignedToId: string | null;
    assignedTo: { id: string; name: string; email: string } | null;
    campaign: { id: string; name: string } | null;
    lastContactAt: string | null;
    nextFollowUpAt: string | null;
    isDemo: boolean;
    createdAt: string;
    updatedAt: string;
    /** 0-100 confidence that the attached website really belongs to this business. */
    websiteMatchConfidence: number | null;
    websiteMatchedBy: string | null;
    websiteMatchReasons: {
      signals?: Array<{ key: string; labelFa: string; points: number; maxPoints: number; matched: boolean; evidence: string }>;
      reasons?: string[];
      suggestions?: Array<{ url: string; domain: string; confidence: number; reasons: string[] }>;
      method?: string;
      searchProvider?: string | null;
    } | null;
    lastCrawledAt: string | null;
    sourceReferences: Array<{
      id: string;
      providerKey: string;
      externalId: string | null;
      sourceUrl: string | null;
      fields: string[];
      origin: string;
      confidence: string;
      fetchedAt: string;
      raw: unknown;
    }>;
    socialSignals: Array<{
      id: string;
      platform: string;
      url: string;
      handle: string | null;
      followers: number | null;
      isActive: boolean | null;
      confidence: string;
      source: string | null;
      observedAt: string;
    }>;
    businessSignals: Array<{
      id: string;
      key: string;
      value: boolean;
      evidence: string | null;
      confidence: string;
      weightHint: number | null;
    }>;
    opportunities_: Array<{
      id: string;
      serviceKey: string;
      score: number;
      level: string;
      reasons: string[];
      marketBoost: number;
      isPrimary: boolean;
    }>;
    scores: Array<{ id: string; score: number; temperature: string; reason: string | null; createdAt: string }>;
    aiAnalyses: AiAnalysis[];
    websiteAudits: WebsiteAuditView[];
    salesBriefs: Array<{ id: string; generatedBy: string; content: SalesBriefContent; version: number; createdAt: string }>;
  };
  services: Record<string, { key: string; nameFa: string; nameEn: string }>;
  currentBrief: { id: string; generatedBy: string; content: SalesBriefContent; version: number; createdAt: string } | null;
  latestAudit: WebsiteAuditView | null;
  latestAi: AiAnalysis | null;
}

export interface WebsiteAuditView {
  id: string;
  url: string;
  /**
   * Real-browser measurements, present only when the browser layer ran.
   * A null metric means "not measured" — never zero, and never estimated from the
   * HTTP audit.
   */
  browser?: {
    status: string;
    unavailableReason: string | null;
    lcpMs: number | null;
    cls: number | null;
    inpMs: number | null;
    fcpMs: number | null;
    ttfbMs: number | null;
    fitsMobileViewport: boolean | null;
    horizontalOverflowPx: number | null;
    smallestFontPx: number | null;
    smallTapTargets: number | null;
    requestCount: number | null;
    browserName: string | null;
    createdAt: string;
  } | null;
  finalUrl: string | null;
  reachable: boolean;
  httpStatus: number | null;
  seoScore: number | null;
  mobileScore: number | null;
  performanceScore: number | null;
  uxScore: number | null;
  conversionScore: number | null;
  technicalScore: number | null;
  accessibilityScore: number | null;
  overallScore: number | null;
  unavailable: string[];
  findings: AuditFinding[] | null;
  technologies: DetectedTechnology[] | null;
  pagesCrawled: number;
  totalBytes: number | null;
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
  error: string | null;
  createdAt: string;
  pages?: Array<{
    id: string;
    url: string;
    httpStatus: number | null;
    title: string | null;
    wordCount: number | null;
    role: string | null;
    hasForm: boolean;
    imagesWithoutAlt: number;
    imageCount: number;
  }>;
}

export interface AiAnalysis {
  id: string;
  provider: string;
  model: string;
  businessSummary: string | null;
  likelyCustomerProfile: string | null;
  mainDigitalProblems: string[];
  businessOpportunities: string[];
  recommendedService: string | null;
  secondaryServices: string[];
  salesAngle: string | null;
  whyContact: string | null;
  recommendedOpening: string | null;
  recommendedQuestions: string[];
  likelyObjections: string[];
  objectionStrategy: string | null;
  recommendedNextStep: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

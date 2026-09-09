import type {
  ActivityType,
  BusinessValueTier,
  CallOutcome,
  CampaignStatus,
  ContactStatus,
  KeywordSource,
  LeadTemperature,
  MarketSignalStrength,
  NotificationChannel,
  NotificationEvent,
  ProviderKind,
  ProviderState,
  Role,
  RunStatus,
  TaskPriority,
  TaskStatus,
  WebsiteFilter,
  WebsiteStatus,
} from './enums';
import type { Confidence } from './provenance';
import type { ScoringSignal } from './scoring';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  telegramChatId: string | null;
  locale: string;
  theme: string;
}

export interface AuthResponse {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** One reason contributing to a score, always shown next to the number. */
export interface ScoreContribution {
  signal: ScoringSignal | string;
  points: number;
  labelFa: string;
  labelEn: string;
  evidence: string;
  confidence: Confidence;
}

export interface LeadListItem {
  id: string;
  businessName: string;
  category: string | null;
  city: string | null;
  province: string | null;
  normalizedPhone: string | null;
  website: string | null;
  websiteStatus: WebsiteStatus;
  leadScore: number | null;
  leadTemperature: LeadTemperature | null;
  businessValueScore: number | null;
  businessValueTier: BusinessValueTier;
  recommendedService: string | null;
  recommendedServiceName: string | null;
  contactStatus: ContactStatus;
  assignedToId: string | null;
  assignedToName: string | null;
  nextFollowUpAt: string | null;
  lastContactAt: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeadFilters {
  q?: string;
  city?: string[];
  province?: string[];
  category?: string[];
  temperature?: LeadTemperature[];
  minScore?: number;
  maxScore?: number;
  websiteStatus?: WebsiteStatus[];
  websiteFilter?: WebsiteFilter;
  recommendedService?: string[];
  contactStatus?: ContactStatus[];
  assignedToId?: string[];
  unassigned?: boolean;
  source?: string[];
  campaignId?: string;
  businessValueTier?: BusinessValueTier[];
  includeDemo?: boolean;
  onlyDemo?: boolean;
  followUpDue?: boolean;
  page?: number;
  pageSize?: number;
  sort?: 'score_desc' | 'value_desc' | 'newest' | 'oldest' | 'followup_asc' | 'name_asc';
}

export interface AuditScores {
  seo: number | null;
  mobile: number | null;
  performance: number | null;
  ux: number | null;
  conversion: number | null;
  technical: number | null;
  accessibility: number | null;
  overall: number | null;
}

export interface WebsiteAuditSummary {
  id: string;
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  reachable: boolean;
  scores: AuditScores;
  /** Measurements that could not be taken, so the UI can say "unavailable" rather than 0. */
  unavailable: string[];
  findings: AuditFinding[];
  technologies: DetectedTechnology[];
  pagesCrawled: number;
  createdAt: string;
}

export interface AuditFinding {
  code: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
  area: 'SEO' | 'MOBILE' | 'PERFORMANCE' | 'UX' | 'CONVERSION' | 'TECHNICAL' | 'ACCESSIBILITY' | 'TRUST' | 'CONTENT';
  titleFa: string;
  titleEn: string;
  evidence: string;
  confidence: Confidence;
}

export interface DetectedTechnology {
  name: string;
  category: string;
  /** Heuristic detection is never presented as certain. */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  evidence: string;
}

/**
 * One claim in the brief, with the observation that supports it.
 *
 * A salesperson repeats these sentences on a call, so every one has to be traceable:
 * "their mobile site is unusable" is only sayable when a specific check found a specific
 * defect on a specific page. `sourceFa` names where the observation came from, and
 * `confidence` says whether it was measured, calculated or inferred.
 */
export interface BriefClaim {
  textFa: string;
  /** The concrete observation: "no viewport meta tag on the home page". */
  evidenceFa: string;
  /** Where it came from: the official website, the business listing, our own audit. */
  sourceFa: string;
  confidence: Confidence;
}

export interface SalesBriefContent {
  whyContactFa: string;
  /** Kept as plain strings for compact views; `keyProblems` carries the evidence. */
  keyProblemsFa: string[];
  /** The same problems with their evidence and source attached (patch 23). */
  keyProblems: BriefClaim[];
  recommendedServiceKey: string | null;
  recommendedServiceNameFa: string | null;
  secondaryServiceKeys: string[];
  salesAngleFa: string;
  openings: Array<{
    style: 'PROBLEM' | 'OPPORTUNITY' | 'AUDIT' | 'NEUTRAL';
    textFa: string;
    /**
     * True when every claim in this sentence is something the system actually observed.
     *
     * A false here is not a defect — a neutral opening that asks a question rather than
     * asserting anything is perfectly good sales copy. What must never happen is a
     * sentence that *sounds* like an observation without being one, so the flag lets the
     * UI mark which openings are safe to lean on.
     */
    factBased: boolean;
    /** The observations the sentence rests on, if any. */
    basedOnFa: string[];
  }>;
  questionsFa: string[];
  objections: Array<{ objectionFa: string; responseFa: string }>;
  nextActionFa: string;
  /** ISO date the salesperson should follow up if the call does not happen today. */
  suggestedFollowUpAt: string | null;
  /** Which parts came from the deterministic engine and which from the model. */
  generatedBy: 'RULES' | 'AI' | 'HYBRID';
  disclaimersFa: string[];
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: CampaignStatus;
  city: string | null;
  province: string | null;
  categories: string[];
  websiteFilter: WebsiteFilter;
  minLeadScore: number | null;
  limit: number;
  providers: string[];
  createdAt: string;
  lastRunAt: string | null;
  stats: CampaignRunStats | null;
}

export interface CampaignRunStats {
  collected: number;
  unique: number;
  qualified: number;
  hot: number;
  warm: number;
  medium: number;
  low: number;
  rejected: number;
  errors: number;
  merged: number;
}

export interface CampaignRunSummary {
  id: string;
  campaignId: string;
  status: RunStatus;
  stage: string | null;
  progress: number;
  stats: CampaignRunStats;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface ProviderInfo {
  key: string;
  kind: ProviderKind;
  displayName: string;
  description: string;
  state: ProviderState;
  enabled: boolean;
  /** Names of environment/config keys the adapter needs. Values are never returned. */
  requiredConfig: string[];
  missingConfig: string[];
  /** Whether the provider is free to use, or bills per request. */
  cost: 'FREE' | 'PAID' | 'FREEMIUM';
  lastError: string | null;
  lastUsedAt: string | null;
  docsUrl?: string;
}

export interface ProviderUsageSummary {
  providerKey: string;
  displayName: string;
  kind: ProviderKind;
  requestsToday: number;
  requestsThisMonth: number;
  failuresToday: number;
  failuresThisMonth: number;
  tokensThisMonth: number;
  estimatedCostThisMonthUsd: number;
  lastUsedAt: string | null;
}

export interface DashboardKpis {
  totalLeads: number;
  hotLeads: number;
  warmLeads: number;
  readyToCall: number;
  callsToday: number;
  followUpsDue: number;
  followUpsOverdue: number;
  meetings: number;
  proposals: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  leadsWithoutWebsite: number;
  auditedLeads: number;
}

export interface MarketKpis {
  topService: { key: string; name: string; strength: MarketSignalStrength } | null;
  topCity: { city: string; strength: MarketSignalStrength } | null;
  topKeyword: { keyword: string; metricLabel: string } | null;
  trendLabel: string;
  hasData: boolean;
}

export interface MarketSignalView {
  id: string;
  serviceKey: string | null;
  serviceName: string | null;
  city: string | null;
  province: string | null;
  strength: MarketSignalStrength;
  /** Human-readable basis, e.g. "312 impressions / 18 clicks (Google Ads, last 30d)". */
  basis: string;
  confidence: Confidence;
  sources: KeywordSource[];
  periodStart: string | null;
  periodEnd: string | null;
  sampleSize: number;
}

export interface KeywordView {
  id: string;
  keyword: string;
  normalizedKeyword: string;
  language: string | null;
  city: string | null;
  province: string | null;
  serviceKey: string | null;
  source: KeywordSource;
  sourceUrl: string | null;
  searchVolume: number | null;
  competition: string | null;
  trend: string | null;
  clicks: number | null;
  impressions: number | null;
  conversions: number | null;
  costMicros: number | null;
  ctr: number | null;
  averagePosition: number | null;
  date: string | null;
}

export interface OpportunityMatch {
  leadId: string;
  businessName: string;
  city: string | null;
  serviceKey: string;
  serviceName: string;
  opportunityScore: number;
  opportunityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  reasonsFa: string[];
  leadScore: number | null;
  businessValueTier: BusinessValueTier;
}

export interface ActivityView {
  id: string;
  type: ActivityType;
  title: string;
  body: string | null;
  outcome: CallOutcome | null;
  durationSeconds: number | null;
  createdAt: string;
  userName: string | null;
}

export interface TaskView {
  id: string;
  leadId: string | null;
  leadName: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  isOverdue: boolean;
}

export interface NotificationView {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  title: string;
  body: string | null;
  leadId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SourceReferenceView {
  id: string;
  providerKey: string;
  providerName: string;
  externalId: string | null;
  sourceUrl: string | null;
  /** Which fields this source contributed. */
  fields: string[];
  fetchedAt: string;
  raw?: unknown;
}

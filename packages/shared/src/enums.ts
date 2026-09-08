/**
 * Enumerations shared between the API and the web dashboard.
 * These mirror the Prisma enums one-to-one; the Prisma schema is the source of truth
 * for the database, this file is the source of truth for the wire format.
 */

export const ROLES = ['ADMIN', 'SALES_MANAGER', 'SALESPERSON'] as const;
export type Role = (typeof ROLES)[number];

export const WEBSITE_STATUSES = [
  'UNKNOWN',
  'NO_WEBSITE',
  'NOT_VERIFIED',
  'ACTIVE',
  'PARKED',
  'BROKEN',
  'SOCIAL_ONLY',
] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

export const LEAD_TEMPERATURES = ['LOW', 'MEDIUM', 'WARM', 'HOT'] as const;
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

export const BUSINESS_VALUE_TIERS = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const;
export type BusinessValueTier = (typeof BUSINESS_VALUE_TIERS)[number];

export const CONTACT_STATUSES = [
  'NEW',
  'RESEARCHED',
  'READY_TO_CALL',
  'CONTACTED',
  'NO_ANSWER',
  'CALLBACK',
  'INTERESTED',
  'MEETING',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
  'NOT_INTERESTED',
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** Statuses that mean the deal is finished, one way or the other. */
export const TERMINAL_CONTACT_STATUSES: ContactStatus[] = ['WON', 'LOST', 'NOT_INTERESTED'];

/** Ordered sales pipeline used by the funnel views. */
export const PIPELINE_ORDER: ContactStatus[] = [
  'NEW',
  'RESEARCHED',
  'READY_TO_CALL',
  'CONTACTED',
  'CALLBACK',
  'INTERESTED',
  'MEETING',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
];

export const CAMPAIGN_STATUSES = ['DRAFT', 'READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const RUN_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const PROVIDER_KINDS = [
  'LEAD_SOURCE',
  'SEARCH',
  'BUSINESS_DATA',
  'WEBSITE',
  'AI',
  'KEYWORD_INSIGHT',
  'NOTIFICATION',
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVIDER_STATES = ['CONFIGURED', 'NOT_CONFIGURED', 'DISABLED', 'ERROR'] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];

export const WEBSITE_FILTERS = ['ANY', 'NO_WEBSITE', 'HAS_WEBSITE'] as const;
export type WebsiteFilter = (typeof WEBSITE_FILTERS)[number];

export const ACTIVITY_TYPES = [
  'CALL',
  'NOTE',
  'STATUS_CHANGE',
  'ASSIGNMENT',
  'EMAIL',
  'MEETING',
  'PROPOSAL_SENT',
  'FOLLOW_UP',
  'SYSTEM',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const CALL_OUTCOMES = [
  'ANSWERED',
  'NO_ANSWER',
  'BUSY',
  'WRONG_NUMBER',
  'CALLBACK_REQUESTED',
  'NOT_INTERESTED',
  'INTERESTED',
  'MEETING_SET',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const TASK_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const NOTIFICATION_EVENTS = [
  'HOT_LEAD',
  'LEAD_ASSIGNED',
  'FOLLOW_UP_DUE',
  'CAMPAIGN_COMPLETED',
  'AI_ANALYSIS_COMPLETED',
  'PROVIDER_FAILURE',
  'DAILY_SUMMARY',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'TELEGRAM', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const MARKET_SIGNAL_STRENGTHS = ['INSUFFICIENT_DATA', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const;
export type MarketSignalStrength = (typeof MARKET_SIGNAL_STRENGTHS)[number];

export const KEYWORD_SOURCES = [
  'GOOGLE_ADS',
  'SEARCH_CONSOLE',
  'MANUAL_IMPORT',
  'SITE_ANALYTICS',
  'PROVIDER',
] as const;
export type KeywordSource = (typeof KEYWORD_SOURCES)[number];

export const DATA_ORIGINS = [
  'PUBLIC_BUSINESS_RESEARCH',
  'FIRST_PARTY_BAIMAR',
  'ADVERTISING_CAMPAIGN',
  'AGGREGATE_SEARCH_SIGNAL',
  'AI_INFERENCE',
  'MANUAL_ENTRY',
] as const;
/**
 * Where a piece of data came from. This is deliberately separate from `Confidence`:
 * origin answers "which world does this belong to", confidence answers "how sure are we".
 */
export type DataOrigin = (typeof DATA_ORIGINS)[number];

export const JOB_NAMES = [
  'discover_businesses',
  'normalize_lead',
  'deduplicate_lead',
  'discover_website',
  'crawl_website',
  'audit_website',
  'calculate_score',
  'analyze_lead',
  'generate_sales_brief',
  'send_notification',
  'market_analysis',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

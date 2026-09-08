import type { ProviderKind } from '@prisma/client';
import type { DataOrigin } from '@baimar/shared';

/**
 * Provider contracts.
 *
 * The rule the whole platform is built on: no capability may depend on a single vendor.
 * Each capability is expressed as an interface here; adapters implement it, the registry
 * picks whichever adapters are configured, and a missing or failing adapter degrades that
 * one capability instead of breaking the request.
 */

export interface ProviderDescriptor {
  key: string;
  kind: ProviderKind;
  displayName: string;
  description: string;
  /** Environment variables (or admin settings) the adapter needs before it can run. */
  requiredConfig: string[];
  cost: 'FREE' | 'PAID' | 'FREEMIUM';
  docsUrl?: string;
  /** Conservative defaults; administrators can tighten them in Settings → Limits. */
  defaultRateLimit?: { perMinute?: number; perHour?: number; perDay?: number };
  /** Higher priority adapters are tried first within the same capability. */
  priority?: number;
  /** Licensing / attribution obligations that the UI must display. */
  attribution?: string;
}

export interface BaseProvider {
  readonly descriptor: ProviderDescriptor;
  /** True when every required credential/setting is present. */
  isConfigured(): boolean;
  /** Names of the missing settings, for the "Not configured" panel. */
  missingConfig(): string[];
  /** Cheap liveness probe used by Settings → Integrations. */
  healthCheck?(): Promise<{ ok: boolean; message: string }>;
}

/* -------------------------------------------------------------------------- */
/*  Lead sources                                                               */
/* -------------------------------------------------------------------------- */

export interface DiscoveryQuery {
  /** Free-text category or business type, e.g. "کلینیک زیبایی" / "dental clinic". */
  category: string;
  city?: string;
  province?: string;
  country?: string;
  /** Optional geographic anchor, when the provider supports radius search. */
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  limit: number;
  language?: string;
  signal?: AbortSignal;
}

/**
 * Normalized business record produced by every lead source. Fields the source did not
 * supply stay `undefined` — adapters must never invent values to fill the shape.
 */
export interface DiscoveredBusiness {
  providerKey: string;
  externalId?: string;
  sourceUrl?: string;
  origin: DataOrigin;

  name: string;
  category?: string;
  subcategory?: string;
  businessType?: string;

  country?: string;
  province?: string;
  city?: string;
  area?: string;
  address?: string;
  latitude?: number;
  longitude?: number;

  phone?: string;
  extraPhones?: string[];
  email?: string;
  website?: string;

  googleMapsUrl?: string;
  instagramUrl?: string;
  telegramUrl?: string;
  linkedinUrl?: string;
  whatsappUrl?: string;
  facebookUrl?: string;

  description?: string;
  services?: string[];
  products?: string[];
  openingHours?: Record<string, string> | string[] | null;

  reviewCount?: number;
  reviewRating?: number;

  /** Anything else the provider returned, retained verbatim for auditability. */
  raw?: unknown;
}

export interface LeadSourceProvider extends BaseProvider {
  discover(query: DiscoveryQuery): Promise<DiscoveredBusiness[]>;
}

/* -------------------------------------------------------------------------- */
/*  Search                                                                     */
/* -------------------------------------------------------------------------- */

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  rank: number;
}

export interface SearchProvider extends BaseProvider {
  search(query: string, opts?: { count?: number; country?: string; language?: string; signal?: AbortSignal }): Promise<SearchResult[]>;
}

/* -------------------------------------------------------------------------- */
/*  Business data enrichment                                                   */
/* -------------------------------------------------------------------------- */

export interface EnrichmentInput {
  businessName: string;
  city?: string | null;
  province?: string | null;
  phone?: string | null;
  website?: string | null;
  category?: string | null;
}

export interface BusinessDataProvider extends BaseProvider {
  enrich(input: EnrichmentInput): Promise<Partial<DiscoveredBusiness> | null>;
}

/* -------------------------------------------------------------------------- */
/*  Website fetching                                                           */
/* -------------------------------------------------------------------------- */

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  headers: Record<string, string>;
  bytes: number;
  responseMs: number;
  truncated: boolean;
}

export interface WebsiteProvider extends BaseProvider {
  fetchPage(url: string, opts?: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal }): Promise<FetchedPage>;
  isAllowed(url: string): Promise<{ allowed: boolean; reason?: string }>;
}

/* -------------------------------------------------------------------------- */
/*  AI                                                                         */
/* -------------------------------------------------------------------------- */

export interface AICompletionRequest {
  system: string;
  user: string;
  /** When set, the adapter asks the model for strict JSON. */
  jsonSchemaName?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AICompletionResult {
  text: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  latencyMs: number;
  raw?: unknown;
}

export interface AIProvider extends BaseProvider {
  readonly model: string;
  complete(req: AICompletionRequest): Promise<AICompletionResult>;
}

/* -------------------------------------------------------------------------- */
/*  Keyword / market insight                                                   */
/* -------------------------------------------------------------------------- */

export interface KeywordQuery {
  keywords?: string[];
  city?: string;
  province?: string;
  country?: string;
  language?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * One keyword observation. Every metric is optional because no provider returns them all,
 * and a missing metric must surface as "unavailable", never as zero.
 */
export interface KeywordObservation {
  keyword: string;
  source: 'GOOGLE_ADS' | 'SEARCH_CONSOLE' | 'MANUAL_IMPORT' | 'SITE_ANALYTICS' | 'PROVIDER';
  origin: DataOrigin;
  sourceUrl?: string;
  language?: string;
  city?: string;
  province?: string;
  country?: string;
  searchVolume?: number;
  competition?: string;
  competitionIndex?: number;
  trend?: string;
  clicks?: number;
  impressions?: number;
  conversions?: number;
  costMicros?: number;
  ctr?: number;
  averagePosition?: number;
  date?: Date;
  periodStart?: Date;
  periodEnd?: Date;
}

/** A search term that actually triggered one of Baimar's own ads. */
export interface SearchTermObservation extends KeywordObservation {
  term: string;
  campaignName?: string;
  adGroupName?: string;
  matchType?: string;
  averageCpcMicros?: number;
}

export interface KeywordInsightProvider extends BaseProvider {
  /** Aggregate demand data for a keyword set (volume, competition, trend). */
  fetchKeywordData?(query: KeywordQuery): Promise<KeywordObservation[]>;
  /** First-party / advertising search terms the authenticated account may read. */
  fetchSearchTerms?(query: KeywordQuery): Promise<SearchTermObservation[]>;
}

/* -------------------------------------------------------------------------- */
/*  Notifications                                                              */
/* -------------------------------------------------------------------------- */

export interface NotificationMessage {
  title: string;
  body: string;
  /** Channel-specific target: a Telegram chat id, an e-mail address… */
  target?: string | null;
  url?: string;
  /** Markdown-ish formatting hint. */
  format?: 'text' | 'markdown' | 'html';
}

export interface NotificationProvider extends BaseProvider {
  send(message: NotificationMessage): Promise<{ ok: boolean; message: string }>;
}

export type AnyProvider =
  | LeadSourceProvider
  | SearchProvider
  | BusinessDataProvider
  | WebsiteProvider
  | AIProvider
  | KeywordInsightProvider
  | NotificationProvider;

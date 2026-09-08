import {
  DEFAULT_BUSINESS_VALUE_CONFIG,
  DEFAULT_SCORING_CONFIG,
  type BusinessValueConfig,
  type ScoringConfig,
} from '@baimar/shared';
import { prisma } from './prisma';
import { cacheDel, cacheGet, cacheSet } from './cache';

/**
 * Typed accessors for the SystemSetting table.
 *
 * Every tunable in the platform (scoring weights, thresholds, crawler budget, AI budget)
 * is stored here so administrators can change behaviour without a redeploy. Defaults live
 * in @baimar/shared so the engine still works on a fresh database.
 */

export const SETTING_KEYS = {
  scoring: 'scoring.config',
  businessValue: 'scoring.business_value',
  ai: 'ai.config',
  crawler: 'crawler.config',
  market: 'market.config',
  notifications: 'notifications.config',
  general: 'general.config',
} as const;

const CACHE_TTL = 60;

export interface AiSettings {
  provider: 'anthropic' | 'openai' | 'compatible' | 'local' | 'none';
  model: string | null;
  temperature: number;
  maxTokens: number;
  monthlyBudgetUsd: number;
  minLeadScore: number;
  /** Re-analysing an unchanged lead is refused unless the caller forces it. */
  cacheEnabled: boolean;
}

export interface CrawlerSettings {
  respectRobots: boolean;
  maxPages: number;
  timeoutMs: number;
  delayMs: number;
  maxBytes: number;
  /** Re-audit a website at most this often, in hours. */
  reauditAfterHours: number;
}

export interface MarketSettings {
  /** Minimum number of observations before a demand signal is reported at all. */
  minSampleSize: number;
  /** Lookback window for demand aggregation, in days. */
  lookbackDays: number;
  /** Score cut-offs for the demand strength labels. */
  thresholds: { veryHigh: number; high: number; medium: number; low: number };
}

export interface NotificationSettings {
  hotLeadThreshold: number;
  telegramEnabled: boolean;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  dailySummaryHour: number;
}

export interface GeneralSettings {
  organizationName: string;
  defaultCountry: string;
  defaultCity: string | null;
  /** Show demo rows in the main lists. Demo rows are always badged in the UI. */
  showDemoData: boolean;
  currency: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'none',
  model: null,
  temperature: 0.2,
  maxTokens: 2000,
  monthlyBudgetUsd: 25,
  minLeadScore: 65,
  cacheEnabled: true,
};

export const DEFAULT_CRAWLER_SETTINGS: CrawlerSettings = {
  respectRobots: true,
  maxPages: 8,
  timeoutMs: 15000,
  delayMs: 1500,
  maxBytes: 2_500_000,
  reauditAfterHours: 24 * 14,
};

export const DEFAULT_MARKET_SETTINGS: MarketSettings = {
  minSampleSize: 3,
  lookbackDays: 90,
  thresholds: { veryHigh: 80, high: 60, medium: 40, low: 20 },
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  hotLeadThreshold: 80,
  telegramEnabled: true,
  emailEnabled: false,
  inAppEnabled: true,
  dailySummaryHour: 9,
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  organizationName: 'بایمر',
  defaultCountry: 'IR',
  defaultCity: null,
  showDemoData: false,
  currency: 'IRR',
};

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const cacheKey = `setting:${key}`;
  const hit = await cacheGet<T>(cacheKey);
  if (hit !== null) return hit;
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    const value = row ? ({ ...(fallback as object), ...(row.value as object) } as T) : fallback;
    await cacheSet(cacheKey, value, CACHE_TTL);
    return value;
  } catch {
    return fallback;
  }
}

export async function writeSetting(key: string, value: unknown, updatedById?: string, description?: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as object, updatedById, description },
    update: { value: value as object, updatedById, description },
  });
  await cacheDel(`setting:${key}`);
}

export const getScoringConfig = () => readSetting<ScoringConfig>(SETTING_KEYS.scoring, DEFAULT_SCORING_CONFIG);
export const getBusinessValueConfig = () =>
  readSetting<BusinessValueConfig>(SETTING_KEYS.businessValue, DEFAULT_BUSINESS_VALUE_CONFIG);
export const getAiSettings = () => readSetting<AiSettings>(SETTING_KEYS.ai, DEFAULT_AI_SETTINGS);
export const getCrawlerSettings = () => readSetting<CrawlerSettings>(SETTING_KEYS.crawler, DEFAULT_CRAWLER_SETTINGS);
export const getMarketSettings = () => readSetting<MarketSettings>(SETTING_KEYS.market, DEFAULT_MARKET_SETTINGS);
export const getNotificationSettings = () =>
  readSetting<NotificationSettings>(SETTING_KEYS.notifications, DEFAULT_NOTIFICATION_SETTINGS);
export const getGeneralSettings = () => readSetting<GeneralSettings>(SETTING_KEYS.general, DEFAULT_GENERAL_SETTINGS);

export async function invalidateSettingsCache(): Promise<void> {
  await cacheDel('setting:*');
}

import { z } from 'zod';

/**
 * Environment contract.
 *
 * Every integration is optional by construction: the schema only *requires* the values
 * without which the process cannot boot (database, redis, secrets). Anything else is
 * validated when present and reported as "Not configured" when absent.
 */

const bool = (def: boolean) =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      if (typeof v === 'boolean') return v;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const int = (def: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    });

const str = () =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: int(4000),
  API_HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  CORS_EXTRA_ORIGINS: str(),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: bool(false),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: int(900),
  JWT_REFRESH_TTL: int(60 * 60 * 24 * 30),
  APP_ENCRYPTION_KEY: z.string().min(16, 'APP_ENCRYPTION_KEY must be at least 16 characters'),

  SEED_ADMIN_EMAIL: z.string().default('admin@baimar.local'),
  SEED_ADMIN_PASSWORD: z.string().default('ChangeMe123!'),
  SEED_ADMIN_NAME: z.string().default('Baimar Admin'),

  CRAWLER_USER_AGENT: z.string().default('BaimarLeadIntelligenceBot/1.0 (+https://baimar.ir/bot)'),
  CRAWLER_RESPECT_ROBOTS: bool(true),
  CRAWLER_MAX_PAGES: int(8),
  CRAWLER_TIMEOUT_MS: int(15000),
  CRAWLER_DELAY_MS: int(1500),
  CRAWLER_MAX_BYTES: int(2_500_000),
  CRAWLER_CONCURRENCY: int(3),
  CRAWLER_MAX_REDIRECTS: int(4),
  /// Allow crawling private/loopback addresses. Only ever switched on for a local
  /// test fixture; leaving it on in production is a server-side request forgery hole.
  CRAWLER_ALLOW_PRIVATE_HOSTS: bool(false),
  /// Days before an existing audit is considered stale and a lead may be recrawled.
  AUDIT_TTL_DAYS: int(30),
  AUDIT_TTL_DAYS_HOT: int(14),

  /// Optional real-browser audit. Off by default: Chromium needs ~400 MB of RAM,
  /// which a 2 CPU / 4 GB VPS cannot spare while a campaign is running.
  BROWSER_AUDIT_ENABLED: bool(false),
  BROWSER_AUDIT_CONCURRENCY: int(1),
  BROWSER_AUDIT_TIMEOUT_MS: int(45000),
  BROWSER_AUDIT_EXECUTABLE_PATH: str(),

  /// Minimum confidence (0-100) before a searched-for website is attached to a lead.
  WEBSITE_MATCH_MIN_CONFIDENCE: int(55),

  /// CSV import guard rails.
  IMPORT_MAX_BYTES: int(5_000_000),
  IMPORT_MAX_ROWS: int(5000),
  IMPORT_MAX_COLUMNS: int(60),

  /// Log retention, in days. 0 disables the cleanup for that table.
  RETENTION_JOB_LOG_DAYS: int(14),
  RETENTION_AUDIT_LOG_DAYS: int(365),
  RETENTION_PROVIDER_USAGE_DAYS: int(180),
  RETENTION_NOTIFICATION_DAYS: int(90),
  RETENTION_WEBSITE_PAGE_DAYS: int(90),

  QUEUE_PREFIX: z.string().default('baimar'),
  WORKER_CONCURRENCY: int(4),
  RUN_WORKERS_IN_API: bool(true),

  AI_PROVIDER: z.enum(['anthropic', 'openai', 'compatible', 'local', 'none']).default('none'),
  AI_MODEL: str(),
  AI_TEMPERATURE: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? 0.2 : Number(v))),
  AI_MAX_TOKENS: int(2000),
  AI_MONTHLY_BUDGET_USD: int(25),
  AI_MIN_LEAD_SCORE: int(65),
  /// Bumping this invalidates every cached AI analysis (see core/ai-analysis.ts).
  AI_PROMPT_VERSION: z.string().default('2026-09-v2'),
  AI_TIMEOUT_MS: int(60000),
  AI_CONCURRENCY: int(1),

  // Model identifiers are configuration, never constants. Vendors add and retire model
  // names on their own schedule, so the app refuses to guess: when no model is named the
  // adapter reports NOT_CONFIGURED and the deterministic rules engine takes over.
  ANTHROPIC_API_KEY: str(),
  ANTHROPIC_MODEL: str(),
  ANTHROPIC_BASE_URL: z.string().default('https://api.anthropic.com'),
  ANTHROPIC_VERSION: z.string().default('2023-06-01'),

  OPENAI_API_KEY: str(),
  OPENAI_MODEL: str(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),

  COMPATIBLE_AI_API_KEY: str(),
  COMPATIBLE_AI_BASE_URL: str(),
  COMPATIBLE_AI_MODEL: str(),

  LOCAL_AI_BASE_URL: str(),
  LOCAL_AI_MODEL: str(),

  GOOGLE_MAPS_API_KEY: str(),
  GOOGLE_PLACES_LANGUAGE: z.string().default('fa'),
  GOOGLE_PLACES_REGION: z.string().default('ir'),

  OVERPASS_ENABLED: bool(true),
  OVERPASS_ENDPOINT: z.string().default('https://overpass-api.de/api/interpreter'),
  OVERPASS_TIMEOUT_MS: int(60000),

  BRAVE_SEARCH_API_KEY: str(),
  GOOGLE_CSE_API_KEY: str(),
  GOOGLE_CSE_ID: str(),
  DOMAIN_PROBE_ENABLED: bool(true),

  GOOGLE_ADS_DEVELOPER_TOKEN: str(),
  GOOGLE_ADS_CLIENT_ID: str(),
  GOOGLE_ADS_CLIENT_SECRET: str(),
  GOOGLE_ADS_REFRESH_TOKEN: str(),
  GOOGLE_ADS_CUSTOMER_ID: str(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: str(),
  GOOGLE_ADS_API_VERSION: z.string().default('v18'),

  GSC_CLIENT_ID: str(),
  GSC_CLIENT_SECRET: str(),
  GSC_REFRESH_TOKEN: str(),
  GSC_SITE_URL: str(),

  TELEGRAM_BOT_TOKEN: str(),
  TELEGRAM_DEFAULT_CHAT_ID: str(),
  TELEGRAM_API_BASE: z.string().default('https://api.telegram.org'),

  SMTP_HOST: str(),
  SMTP_PORT: int(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: str(),
  SMTP_PASSWORD: str(),
  SMTP_FROM: z.string().default('Baimar <no-reply@baimar.ir>'),

  DEMO_MODE: bool(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(overrides: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(overrides);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example for the full contract.`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the memoized environment. */
export function resetEnvCache(): void {
  cached = null;
}

export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return (loadEnv() as unknown as Record<string, unknown>)[prop];
  },
});

export function allowedOrigins(): string[] {
  const e = loadEnv();
  const extra = (e.CORS_EXTRA_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set([e.WEB_ORIGIN, ...extra]));
}

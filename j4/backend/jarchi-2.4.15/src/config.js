import "dotenv/config";
import fs from "node:fs";

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function trustProxy(value, env) {
  const raw = String(value ?? "").trim();
  // Production normally sits behind a local Nginx/Apache reverse proxy. Trust
  // loopback by default so req.ip/rate limits see X-Forwarded-For without
  // trusting spoofed headers from arbitrary remote peers. Deployments with a
  // different proxy topology can override this with TRUST_PROXY.
  if (!raw) return env === "production" ? "loopback" : false;
  const lower = raw.toLowerCase();
  if (["false", "0", "no", "off"].includes(lower)) return false;
  if (["true", "1", "yes", "on"].includes(lower)) return true;
  return raw;
}

const bool = (value, fallback = false) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
};
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const str = (value, fallback = "") => String(value ?? fallback);

/**
 * SITES_JSON stays supported so 1.2.0 deployments keep booting, but it is a
 * bootstrap mechanism only: clients live in the `sites` table.
 */
function parseSites() {
  let parsed;
  try {
    parsed = JSON.parse(process.env.SITES_JSON || "[]");
  } catch (error) {
    throw new Error(`Invalid SITES_JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error("SITES_JSON must be an array");

  return Object.fromEntries(
    parsed.filter((site) => site?.id).map((site) => [String(site.id), {
      id: String(site.id),
      name: str(site.name, site.id),
      wordpress_url: str(site.wordpress_url),
      webhook_secret: str(site.webhook_secret),
      telegram_channel_id: str(site.telegram_channel_id),
      bale_chat_id: str(site.bale_chat_id),
      owner_telegram_id: str(site.owner_telegram_id),
    }]),
  );
}

export const config = {
  name: "jarchi",
  version: packageVersion(),
  /** WordPress publication contract this backend speaks. */
  contractVersion: "1.3",
  /** Oldest WordPress payload shape still accepted. */
  minContractVersion: "1.0",
  env: str(process.env.NODE_ENV, "development"),
  port: num(process.env.PORT, 3002),
  maxRequestBodyBytes: num(process.env.MAX_REQUEST_BODY_BYTES, 2 * 1024 * 1024),
  publicBaseUrl: str(process.env.PUBLIC_BASE_URL).replace(/\/+$/, ""),
  paymentUrl: str(process.env.JARCHI_PAYMENT_URL),
  databaseUrl: str(process.env.DATABASE_URL),
  /** Timezone used for every admin-facing date grouping and display. */
  timezone: str(process.env.JARCHI_TIMEZONE, "Asia/Tehran"),
  trustProxy: trustProxy(process.env.TRUST_PROXY, str(process.env.NODE_ENV, "development")),

  credentialKey: str(process.env.PLATFORM_CREDENTIAL_KEY),

  admin: {
    /**
     * Legacy 1.2.0 machine token. Still accepted on /api/admin/* so existing
     * automation keeps working; it maps to a synthetic super_admin actor and is
     * recorded as such in the audit log. Leave empty to disable it entirely.
     */
    apiToken: str(process.env.ADMIN_API_TOKEN),
    /** Bootstrap super admin, created on first boot when no admin exists. */
    bootstrapUsername: str(process.env.ADMIN_BOOTSTRAP_USERNAME, "admin"),
    bootstrapPassword: str(process.env.ADMIN_BOOTSTRAP_PASSWORD),
    bootstrapTelegramId: str(process.env.ADMIN_TELEGRAM_ID),
    bootstrapBaleId: str(process.env.ADMIN_BALE_ID),
    cookieName: str(process.env.ADMIN_COOKIE_NAME, "jarchi_admin"),
    cookieSecure: bool(process.env.ADMIN_COOKIE_SECURE, str(process.env.NODE_ENV) === "production"),
    /** Idle timeout: a session dies this long after its last request. */
    sessionIdleMinutes: num(process.env.ADMIN_SESSION_IDLE_MINUTES, 60),
    /** Hard cap regardless of activity. */
    sessionAbsoluteHours: num(process.env.ADMIN_SESSION_ABSOLUTE_HOURS, 12),
    /** Rotate the session token when it is older than this. */
    sessionRotateMinutes: num(process.env.ADMIN_SESSION_ROTATE_MINUTES, 15),
    loginMaxAttempts: num(process.env.ADMIN_LOGIN_MAX_ATTEMPTS, 5),
    loginLockMinutes: num(process.env.ADMIN_LOGIN_LOCK_MINUTES, 15),
  },

  rateLimit: {
    enabled: bool(process.env.RATE_LIMIT_ENABLED, true),
    adminWindowMs: num(process.env.RATE_LIMIT_ADMIN_WINDOW_MS, 60000),
    adminMax: num(process.env.RATE_LIMIT_ADMIN_MAX, 240),
    loginWindowMs: num(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 300000),
    loginMax: num(process.env.RATE_LIMIT_LOGIN_MAX, 10),
    webhookWindowMs: num(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS, 60000),
    webhookMax: num(process.env.RATE_LIMIT_WEBHOOK_MAX, 120),
    apiWindowMs: num(process.env.RATE_LIMIT_API_WINDOW_MS, 60000),
    apiMax: num(process.env.RATE_LIMIT_API_MAX, 120),
    botWindowMs: num(process.env.RATE_LIMIT_BOT_WINDOW_MS, 60000),
    botMax: num(process.env.RATE_LIMIT_BOT_MAX, 60),
  },

  pagination: {
    defaultPageSize: num(process.env.PAGE_SIZE_DEFAULT, 25),
    maxPageSize: num(process.env.PAGE_SIZE_MAX, 200),
  },

  retry: {
    enabled: bool(process.env.PUBLICATION_RETRY_ENABLED, true),
    /** Automatic enqueue of retryable publication failures. */
    autoEnqueue: bool(process.env.PUBLICATION_RETRY_AUTO, true),
    maxAttempts: num(process.env.PUBLICATION_RETRY_MAX_ATTEMPTS, 5),
    baseDelayMs: num(process.env.PUBLICATION_RETRY_BASE_DELAY_MS, 60000),
    maxDelayMs: num(process.env.PUBLICATION_RETRY_MAX_DELAY_MS, 3600000),
    intervalMs: num(process.env.PUBLICATION_RETRY_INTERVAL_MS, 60000),
    batchSize: num(process.env.PUBLICATION_RETRY_BATCH, 10),
    lockTimeoutMs: num(process.env.PUBLICATION_RETRY_LOCK_TIMEOUT_MS, 300000),
  },

  telegram: {
    token: str(process.env.TELEGRAM_BOT_TOKEN),
    webhookUrl: str(process.env.TELEGRAM_WEBHOOK_URL),
    /** Verifies Telegram webhook calls; set the same value on setWebhook. */
    webhookSecretToken: str(process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN),
    starsEnabled: bool(process.env.TELEGRAM_STARS_ENABLED, true),
    apiTimeoutMs: num(process.env.TELEGRAM_TIMEOUT_MS, 15000),
  },

  bale: {
    token: str(process.env.BALE_BOT_TOKEN),
    apiBase: str(process.env.BALE_API_BASE, "https://tapi.bale.ai").replace(/\/+$/, ""),
    webhookUrl: str(process.env.BALE_WEBHOOK_URL),
    apiTimeoutMs: num(process.env.BALE_TIMEOUT_MS, 15000),
    miniAppInitDataMaxAgeSeconds: num(process.env.BALE_MINIAPP_INITDATA_MAX_AGE_SECONDS, 3600),
  },

  whatsapp: {
    enabled: bool(process.env.WHATSAPP_ENABLED, false),
    graphVersion: str(process.env.WHATSAPP_GRAPH_VERSION, "v23.0"),
    apiTimeoutMs: num(process.env.WHATSAPP_TIMEOUT_MS, 15000),
  },

  zarinpal: {
    enabled: bool(process.env.ZARINPAL_ENABLED, false),
    merchantId: str(process.env.ZARINPAL_MERCHANT_ID),
    sandbox: bool(process.env.ZARINPAL_SANDBOX, false),
    amountUnit: str(process.env.ZARINPAL_AMOUNT_UNIT, "TOMAN").toUpperCase(),
    callbackUrl: str(process.env.ZARINPAL_CALLBACK_URL),
  },

  /**
   * AI product creation. Credentials come from the environment only and never
   * leave the backend: no route, log line or Mini App response includes them.
   */
  ai: {
    enabled: bool(process.env.AI_ENABLED, false),
    provider: str(process.env.AI_PROVIDER, "openai"),
    apiKey: str(process.env.AI_API_KEY),
    baseUrl: str(process.env.AI_BASE_URL, "https://api.openai.com/v1").replace(/\/+$/, ""),
    textModel: str(process.env.AI_TEXT_MODEL, "gpt-4o-mini"),
    visionModel: str(process.env.AI_VISION_MODEL, "gpt-4o-mini"),
    imageModel: str(process.env.AI_IMAGE_MODEL, "gpt-image-1"),
    maxRetries: num(process.env.AI_MAX_RETRIES, 2),
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 60000),
    defaultLanguage: str(process.env.AI_DEFAULT_LANGUAGE, "fa"),
    enableImageGeneration: bool(process.env.AI_ENABLE_IMAGE_GENERATION, false),
    maxImageBytes: num(process.env.AI_MAX_IMAGE_SIZE, 8 * 1024 * 1024),
    maxImagesPerDraft: num(process.env.AI_MAX_IMAGES_PER_DRAFT, 8),
    maxOutputTokens: num(process.env.AI_MAX_OUTPUT_TOKENS, 4000),
    mediaDir: str(process.env.AI_MEDIA_DIR, "./storage/ai-media"),
    /** Abandoned uploads are swept after this long. */
    mediaTtlHours: num(process.env.AI_MEDIA_TTL_HOURS, 72),
    worker: {
      enabled: bool(process.env.AI_WORKER_ENABLED, true),
      intervalMs: num(process.env.AI_WORKER_INTERVAL_MS, 5000),
      batchSize: num(process.env.AI_WORKER_BATCH, 3),
      lockTimeoutMs: num(process.env.AI_JOB_LOCK_TIMEOUT_MS, 300000),
      maxAttempts: num(process.env.AI_JOB_MAX_ATTEMPTS, 3),
      baseDelayMs: num(process.env.AI_JOB_BASE_DELAY_MS, 15000),
      maxDelayMs: num(process.env.AI_JOB_MAX_DELAY_MS, 900000),
    },
    rateLimit: {
      generateWindowMs: num(process.env.RATE_LIMIT_AI_GENERATE_WINDOW_MS, 3600000),
      generateMax: num(process.env.RATE_LIMIT_AI_GENERATE_MAX, 30),
      imageWindowMs: num(process.env.RATE_LIMIT_AI_IMAGE_WINDOW_MS, 3600000),
      imageMax: num(process.env.RATE_LIMIT_AI_IMAGE_MAX, 20),
      uploadWindowMs: num(process.env.RATE_LIMIT_AI_UPLOAD_WINDOW_MS, 3600000),
      uploadMax: num(process.env.RATE_LIMIT_AI_UPLOAD_MAX, 60),
      publishWindowMs: num(process.env.RATE_LIMIT_AI_PUBLISH_WINDOW_MS, 3600000),
      publishMax: num(process.env.RATE_LIMIT_AI_PUBLISH_MAX, 30),
    },
  },

  woocommerce: {
    timeoutMs: num(process.env.WOOCOMMERCE_TIMEOUT_MS, 20000),
    /** Set true only for a staging store with a self-signed certificate. */
    allowInsecureTls: bool(process.env.WOOCOMMERCE_ALLOW_INSECURE_TLS, false),
    /** Loopback/private hosts are refused unless a deployment opts in. */
    allowPrivateHosts: bool(process.env.WOOCOMMERCE_ALLOW_PRIVATE_HOSTS, false),
  },

  expiryNoticeDays: str(process.env.EXPIRY_NOTICE_DAYS, "3,1").split(",").map(Number).filter(Number.isFinite),
  expiryScanIntervalMs: num(process.env.EXPIRY_SCAN_INTERVAL_MS, 3600000),
  dashboardCacheMs: num(process.env.DASHBOARD_CACHE_MS, 30000),
  botStateTtlMinutes: num(process.env.ADMIN_BOT_STATE_TTL_MINUTES, 15),

  logLevel: str(process.env.LOG_LEVEL, "info"),
  logDir: str(process.env.LOG_DIR, "./logs"),
  logFile: str(process.env.LOG_FILE, "jarchi.log"),
  customerSessionCookieName: str(process.env.CUSTOMER_SESSION_COOKIE_NAME, "jarchi_session"),
  logMaxBytes: num(process.env.LOG_MAX_BYTES, 5242880),
  logBackups: num(process.env.LOG_BACKUPS, 5),
  httpLogSuccess: bool(process.env.LOG_HTTP_SUCCESS, true),
  slowRequestMs: num(process.env.SLOW_REQUEST_MS, 750),
  autoTrialOnStart: bool(process.env.AUTO_TRIAL_ON_START, false),

  plans: {
    monthly: num(process.env.PLAN_MONTHLY_PRICE, 990000),
    quarterly: num(process.env.PLAN_QUARTERLY_PRICE, 2490000),
    semiannual: num(process.env.PLAN_SEMIANNUAL_PRICE, 4490000),
    annual: num(process.env.PLAN_ANNUAL_PRICE, 7990000),
  },

  sites: parseSites(),
};

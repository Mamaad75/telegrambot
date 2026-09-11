import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { pingDatabase } from "./db/db.js";
import { api } from "./routes/api.js";
import { aiProducts } from "./routes/aiProducts.js";
import { siteAi } from "./routes/siteAi.js";
import { accountRoutes } from "./routes/account.js";
import { ticketRoutes } from "./routes/tickets.js";
import { admin } from "./routes/admin/index.js";
import { miniAppAdminAuth } from "./middleware/miniAppAdminAuth.js";
import { getSite, syncEnvSites, recordWebhookEvent } from "./services/clients.js";
import { upsertFieldCatalog } from "./services/fields.js";
import { normalizeAd } from "./core/normalizer.js";
import { publishAd } from "./core/publication.js";
import { getBot, setTelegramWebhook } from "./platforms/telegram.js";
import { setBaleWebhook } from "./platforms/bale.js";
import { processBaleUpdate, getBaleCustomerBotInfo, logBaleBotReady } from "./bot/bale.js";
import { setupTelegramBot } from "./bot/index.js";
import { callbackZarinPal } from "./services/zarinpal.js";
import { scanExpiry } from "./services/expiry.js";
import { runRetryWorker } from "./services/retry.js";
import { runProductWorker } from "./workers/productWorker.js";
import { purgeAbandonedUploads } from "./services/productImages.js";
import { ensureBootstrapAdmin, purgeExpiredSessions } from "./services/adminUsers.js";
import { purgeExpiredStates } from "./bot/state.js";
import { webhookRateLimit } from "./middleware/rateLimit.js";
import { isOrderEvent } from "./core/orderNormalizer.js";
import { ingestOrderEvent } from "./services/orderIngest.js";
import { orderRoutes } from "./routes/orders.js";
import { safeEqual } from "./utils/security.js";
import { logger } from "./logger.js";
import { safeRequestPath } from "./utils/http.js";
import { purgeExpiredCustomerSessions } from "./services/users.js";
import { applySecurityHeaders } from "./utils/securityHeaders.js";

const app = express();
if (config.trustProxy) app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");
app.use(express.json({ limit: config.maxRequestBodyBytes }));
app.use((req, res, next) => {
  applySecurityHeaders(req, res);
  next();
});

app.use((req, res, next) => {
  const requestId = req.get("X-Request-ID") || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  const started = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - started;
    const isSlow = duration >= config.slowRequestMs;
    if (config.httpLogSuccess || res.statusCode >= 400 || isSlow) {
      const context = {
        request_id: requestId, method: req.method, path: safeRequestPath(req.originalUrl), status: res.statusCode,
        duration_ms: duration, ip: req.ip, user_id: req.user?.id || null,
        site_id: req.site?.id || req.jarchiSiteId || null, role: req.siteRole || req.admin?.role || null,
        slow: isSlow,
      };
      if (res.statusCode >= 500) logger.error("http request completed", context);
      else if (res.statusCode >= 400 || isSlow) logger.warn("http request completed", context);
      else logger.info("http request completed", context);
    }
  });
  next();
});

const root = path.dirname(fileURLToPath(import.meta.url));
app.use("/", express.static(path.resolve(root, "../public"), {
  // Admin and Mini App HTML must not be cached by intermediaries.
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
  },
}));

function siteId(req) {
  return String(
    req.get("X-Site-ID") || req.body?.site_id || req.body?.siteId || req.body?._webhook?.site_id || "",
  ).trim();
}

/**
 * WordPress webhook authentication: the shared secret is compared in constant
 * time, and the outcome is recorded for the client's webhook diagnostics.
 */
async function siteAuth(req, res, next) {
  const id = siteId(req);
  const started = Date.now();
  const reject = async (status, authResult, message) => {
    await recordWebhookEvent({
      site_id: id,
      request_id: req.requestId,
      event_type: String(req.body?.event_type || req.body?.event || ""),
      post_id: String(req.body?.post_id ?? req.body?.id ?? ""),
      http_status: status,
      auth_result: authResult,
      duration_ms: Date.now() - started,
      contract_version: String(req.body?.contract_version || ""),
      error: message,
      ip: req.ip,
    }).catch(() => {});
    logger.warn("webhook authentication rejected", {
      request_id: req.requestId, site_id: id, auth_result: authResult, status,
    });
    return res.status(status).json({ success: false, error: message });
  };

  try {
    if (!id) return res.status(400).json({ success: false, error: "Missing site_id" });

    const site = await getSite(id);
    if (!site) return reject(403, "unknown_site", "Unknown or disabled site");
    if (!site.enabled) return reject(403, "site_disabled", "Unknown or disabled site");

    const supplied = String(req.get("X-Webhook-Secret") || req.get("X-API-Key") || "").trim();
    if (!site.webhook_secret || !safeEqual(supplied, site.webhook_secret)) {
      return reject(401, "invalid_secret", "Invalid webhook authentication");
    }

    req.site = site;
    return next();
  } catch (error) {
    logger.error("site authentication failed", { request_id: req.requestId, site_id: id, error });
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}

/**
 * Liveness. Deliberately dependency-free: a slow or unavailable database must
 * not make the process look dead to a supervisor or load balancer.
 */
app.get("/health", (req, res) => res.json({
  success: true,
  service: "jarchi",
  version: config.version,
  status: "ok",
  uptime_s: Math.round(process.uptime()),
}));

/** Readiness: the dependencies that must work before traffic is useful. */
app.get("/health/ready", async (req, res) => {
  const checks = {};
  let ready = true;

  try {
    checks.database = { ok: true, ...(await pingDatabase(2000)) };
  } catch (error) {
    checks.database = { ok: false, error: error.message };
    ready = false;
  }

  checks.telegram = {
    ok: Boolean(config.telegram.token),
    configured: Boolean(config.telegram.token),
    webhook_configured: Boolean(config.telegram.webhookUrl),
  };
  if (!config.telegram.token) ready = false;

  // Optional dependencies report status without failing readiness.
  checks.bale = {
    ok: true,
    configured: Boolean(config.bale.token),
    webhook_configured: Boolean(config.bale.webhookUrl),
    required: false,
  };
  checks.whatsapp = { ok: true, enabled: config.whatsapp.enabled, required: false };
  checks.credential_key = { ok: Boolean(config.credentialKey), required_for: "platform credentials, phone encryption, WooCommerce keys" };
  checks.ai = {
    ok: true,
    enabled: config.ai.enabled,
    provider: config.ai.enabled ? config.ai.provider : null,
    configured: !config.ai.enabled || String(config.ai.provider).toLowerCase() === "mock" || Boolean(config.ai.apiKey),
    worker_enabled: config.ai.worker.enabled,
    required: false,
  };
  if (!config.credentialKey) ready = false;

  return res.status(ready ? 200 : 503).json({
    success: ready,
    service: "jarchi",
    version: config.version,
    status: ready ? "ready" : "not_ready",
    checks,
  });
});

app.use("/api", api);
app.use("/api", accountRoutes);
// AI product routes extend the customer API; mounted after it so every
// existing route keeps priority and no response contract changes.
app.use("/api", aiProducts);
app.use("/api", siteAi);
app.use("/api", ticketRoutes);
app.use("/api", orderRoutes);
app.use("/api/admin", admin);
// Full admin control inside the same Telegram/Bale Mini App. Native Mini App
// auth identifies the admin, then the existing RBAC router is reused.
app.use("/api/admin-mini", miniAppAdminAuth, admin);

async function handleWordPress(req, res) {
  const started = Date.now();
  const ad = normalizeAd({ ...req.body, site_id: siteId(req) });
  let status = 200;
  let errorMessage = null;
  let platforms = [];

  try {
    logger.info("wordpress webhook received", {
      request_id: req.requestId,
      site_id: ad.site_id,
      post_id: ad.post_id,
      event_type: ad.event_type,
      contract_version: ad.contract_version,
      targets: ad.publication_targets ? Object.keys(ad.publication_targets) : [],
    });

    /*
     * Order events are handled before the post_id guard, and instead of the
     * advert pipeline.
     *
     * An order has an order id, not a post id, and demanding one of an event
     * that has no post is how a working integration reports "Missing post_id".
     * The guard below stays exactly as it is for everything else — it is what
     * keeps a malformed advert from reaching publishAd.
     */
    if (isOrderEvent(ad.event_type)) {
      const outcome = await ingestOrderEvent(req.site, { ...req.body, site_id: ad.site_id }, {
        requestId: req.requestId,
      });

      if (!outcome.accepted) {
        status = 400;
        errorMessage = outcome.reason || "Invalid order event";
        return res.status(400).json({ success: false, error: errorMessage });
      }

      return res.json({
        success: true,
        request_id: req.requestId,
        site_id: ad.site_id,
        event_type: ad.event_type,
        order_id: outcome.order_id,
        duplicate: outcome.duplicate,
        notified: outcome.notified,
      });
    }

    if (!ad.post_id) {
      status = 400;
      errorMessage = "Missing post_id";
      return res.status(400).json({ success: false, error: errorMessage });
    }

    // One statement for the whole field_meta map (1.2.0 issued one per field).
    await upsertFieldCatalog(ad.site_id, ad.field_meta);

    platforms = await publishAd(ad, req.site);
    logger.info("wordpress webhook processed", {
      request_id: req.requestId,
      site_id: ad.site_id,
      post_id: ad.post_id,
      event_type: ad.event_type,
      platforms: platforms.map((item) => ({ platform: item.platform, status: item.status, reason: item.reason })),
      duration_ms: Date.now() - started,
    });

    return res.json({
      success: true,
      request_id: req.requestId,
      site_id: ad.site_id,
      post_id: ad.post_id,
      event_type: ad.event_type,
      platforms,
    });
  } catch (error) {
    status = 500;
    errorMessage = error.message;
    logger.error("wordpress webhook failed", {
      request_id: req.requestId, site_id: ad.site_id, error, duration_ms: Date.now() - started,
    });
    return res.status(500).json({ success: false, request_id: req.requestId, error: "Internal error" });
  } finally {
    // Diagnostics are recorded after the response is decided, so a diagnostics
    // failure can never change the webhook outcome.
    recordWebhookEvent({
      site_id: ad.site_id,
      request_id: req.requestId,
      event_type: ad.event_type,
      post_id: ad.post_id,
      http_status: status,
      auth_result: "ok",
      duration_ms: Date.now() - started,
      contract_version: ad.contract_version,
      targets: platforms.map((item) => ({ platform: item.platform, status: item.status })),
      error: errorMessage,
      ip: req.ip,
    }).catch((error) => logger.warn("webhook diagnostics write failed", { error: error.message }));
  }
}

app.post("/webhook", webhookRateLimit(), siteAuth, handleWordPress);
app.post("/webhooks/wordpress", webhookRateLimit(), siteAuth, handleWordPress);

/*
 * A dedicated order endpoint, on the same authentication as every other
 * WordPress webhook. The shared /webhook route already routes order events to
 * the same place, so a site running the current plugin needs no change; this
 * exists so a plugin can state what it is sending rather than relying on the
 * event type being recognised.
 */
app.post("/webhooks/woocommerce", webhookRateLimit(), siteAuth, async (req, res) => {
  try {
    const outcome = await ingestOrderEvent(req.site, { ...req.body, site_id: req.site.id }, {
      requestId: req.requestId,
    });

    if (!outcome.accepted) {
      return res.status(400).json({ success: false, error: outcome.reason || "Invalid order event" });
    }

    return res.json({
      success: true,
      request_id: req.requestId,
      site_id: req.site.id,
      order_id: outcome.order_id,
      duplicate: outcome.duplicate,
      notified: outcome.notified,
    });
  } catch (error) {
    logger.error("woocommerce webhook failed", { request_id: req.requestId, site_id: req.site?.id, error });
    return res.status(500).json({ success: false, request_id: req.requestId, error: "Internal error" });
  }
});

app.post("/bale-webhook", async (req, res) => {
  try {
    if (!config.bale.token) return res.sendStatus(200);
    await processBaleUpdate(req.body, config.publicBaseUrl);
    return res.sendStatus(200);
  } catch (error) {
    logger.error("bale webhook processing failed", { request_id: req.requestId, error });
    return res.sendStatus(500);
  }
});

app.post("/telegram-webhook", (req, res) => {
  // When a secret token is configured, Telegram echoes it on every call.
  if (config.telegram.webhookSecretToken) {
    const supplied = String(req.get("X-Telegram-Bot-Api-Secret-Token") || "");
    if (!safeEqual(supplied, config.telegram.webhookSecretToken)) {
      logger.warn("telegram webhook rejected", { request_id: req.requestId, reason: "invalid_secret_token" });
      return res.sendStatus(401);
    }
  }
  try {
    const bot = getBot();
    if (bot) bot.processUpdate(req.body);
    return res.sendStatus(200);
  } catch (error) {
    logger.error("telegram webhook processing failed", { request_id: req.requestId, error });
    return res.sendStatus(500);
  }
});

app.get("/api/payments/zarinpal/callback", async (req, res) => {
  try {
    const result = await callbackZarinPal(String(req.query.Authority || ""), String(req.query.Status || "NOK"));
    res.redirect(`${config.publicBaseUrl}/app/?payment=${result.ok ? "success" : "failed"}`);
  } catch (error) {
    logger.error("ZarinPal callback failed", { error });
    res.status(500).send("خطا در تایید پرداخت");
  }
});

app.use((req, res) => res.status(404).json({ success: false, error: "Not found" }));

/* ------------------------------- startup ------------------------------- */

const timers = [];
const every = (intervalMs, name, task) => {
  let stopped = false;
  let timer = null;
  let running = false;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      if (running) return schedule();
      running = true;
      try { await task(); }
      catch (error) { logger.error(`${name} failed`, { error }); }
      finally { running = false; schedule(); }
    }, intervalMs);
    timer.unref?.();
  };
  schedule();
  const handle = { stop(){ stopped = true; if (timer) clearTimeout(timer); } };
  timers.push(handle);
  return handle;
};

/*
 * Startup work that needs the database is non-fatal: the process must still come
 * up and answer /health so a supervisor does not restart-loop during a database
 * outage. /health/ready reports the real state.
 */
await syncEnvSites(config.sites).catch((error) => logger.error("env site sync failed", { error }));
await ensureBootstrapAdmin().catch((error) => logger.error("bootstrap admin failed", { error }));
setupTelegramBot(config.publicBaseUrl);

const server = app.listen(config.port, async () => {
  server.requestTimeout = 30000;
  server.headersTimeout = 35000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  logger.info("jarchi started", {
    port: config.port,
    version: config.version,
    contract_version: config.contractVersion,
    environment: config.env,
    retry_enabled: config.retry.enabled,
  });

  try {
    await setTelegramWebhook();
  } catch (error) {
    logger.error("telegram webhook setup failed", { error });
  }

  try {
    const configured = await setBaleWebhook();
    if (configured) {
      const info = await getBaleCustomerBotInfo();
      logBaleBotReady(info);
      logger.info("bale webhook configured", { url: config.bale.webhookUrl });
    }
  } catch (error) {
    logger.error("bale webhook setup failed", { error });
  }

  every(config.expiryScanIntervalMs, "expiry scan", async () => {
    const bot = getBot();
    if (bot) {
      const result = await scanExpiry((chat, text) => bot.sendMessage(chat, text));
      if (result.expired || result.notified || result.notification_failures) logger.info("expiry scan complete", result);
    }
  });

  if (config.retry.enabled) {
    every(config.retry.intervalMs, "publication retry worker", async () => {
      const result = await runRetryWorker();
      if (result.processed) logger.info("retry worker batch complete", result);
    });
  }

  if (config.ai.enabled && config.ai.worker.enabled) {
    every(config.ai.worker.intervalMs, "ai product worker", async () => {
      const result = await runProductWorker();
      if (result.processed) logger.info("ai worker batch complete", result);
    });
    // Uploads that never became a product should not sit on disk forever.
    every(6 * 3600000, "ai media sweep", async () => {
      const removed = await purgeAbandonedUploads();
      if (removed) logger.info("ai media sweep complete", { removed });
    });
  }

  // Housekeeping: expired admin sessions and abandoned bot flows.
  every(3600000, "session housekeeping", async () => {
    const purged = await purgeExpiredSessions();
    const customerSessions = await purgeExpiredCustomerSessions();
    const states = await purgeExpiredStates();
    if (purged.sessions || customerSessions || states) logger.info("housekeeping complete", {
      ...purged, customer_sessions: customerSessions, bot_states: states,
    });
  });
});

function shutdown(signal) {
  logger.info("shutdown requested", { signal });
  for (const timer of timers) timer?.stop?.();
  server.close(async () => {
    try { const { pool } = await import("./db/db.js"); await pool.end(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => {
  logger.error("unhandled rejection", { error });
  setTimeout(() => process.exit(1), 1000).unref?.();
});
process.on("uncaughtException", (error) => {
  logger.error("uncaught exception", { error });
  setTimeout(() => process.exit(1), 1000).unref?.();
});

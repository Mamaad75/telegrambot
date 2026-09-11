import { config } from "../config.js";
import { getSite } from "./clients.js";
import { getConnection } from "./platformConnections.js";
import { testTelegramTarget, sendTelegramTest, getTelegramBotInfo } from "../platforms/telegram.js";
import { testBaleTarget, sendBaleTest, getBaleBotInfo } from "../platforms/bale.js";
import { testWhatsApp } from "../platforms/whatsapp.js";
import { PlatformError, ERROR_CATEGORIES } from "../platforms/errors.js";
import { maskSecret } from "../utils/security.js";
import { logger } from "../logger.js";

/**
 * Connection testing and diagnostics, shared by the web admin and the Telegram
 * admin bot. Tests use the real platform adapters — nothing here simulates a
 * result, and a platform that cannot be reached is reported as unreachable.
 */

const TEST_MESSAGE = "🔧 تست اتصال جارچی — این پیام از پنل مدیریت ارسال شده است.";

function failure(platform, error) {
  const category = error instanceof PlatformError ? error.category : ERROR_CATEGORIES.UNKNOWN;
  return {
    ok: false,
    platform,
    error: error.message,
    error_code: category,
    retryable: Boolean(error?.retryable),
  };
}

/**
 * @param {"check"|"send"} mode  `check` reads the chat, `send` posts a visible
 *                               probe message into it.
 */
export async function testClientPlatform(siteId, platform, { mode = "check" } = {}) {
  const started = Date.now();
  const site = await getSite(siteId);
  if (!site) throw new Error("Site not found");

  try {
    let result;

    if (platform === "telegram") {
      if (!site.telegram_channel_id) {
        throw new PlatformError("این کلاینت هدف تلگرام ندارد", { platform, category: ERROR_CATEGORIES.CONFIG });
      }
      result = mode === "send"
        ? { ...await sendTelegramTest(site.telegram_channel_id, TEST_MESSAGE), target: site.telegram_channel_id }
        : await testTelegramTarget(site.telegram_channel_id);
    } else if (platform === "bale") {
      if (!site.bale_chat_id) {
        throw new PlatformError("این کلاینت هدف بله ندارد", { platform, category: ERROR_CATEGORIES.CONFIG });
      }
      result = mode === "send"
        ? { ...await sendBaleTest(site.bale_chat_id, TEST_MESSAGE), target: site.bale_chat_id }
        : await testBaleTarget(site.bale_chat_id);
    } else if (platform === "whatsapp") {
      if (!config.whatsapp.enabled) {
        throw new PlatformError("واتس‌اپ در این نصب غیرفعال است", { platform, category: ERROR_CATEGORIES.CONFIG });
      }
      if (!site.owner_user_id) {
        throw new PlatformError("این کلاینت مالک ندارد؛ اتصال واتس‌اپ به مالک وابسته است", {
          platform, category: ERROR_CATEGORIES.CONFIG,
        });
      }
      const connection = await getConnection(site.owner_user_id, "whatsapp", config.credentialKey);
      if (!connection) {
        throw new PlatformError("اتصال واتس‌اپ برای این کلاینت ثبت نشده است", {
          platform, category: ERROR_CATEGORIES.CONFIG,
        });
      }
      // Credentials go to the adapter and never into the result.
      result = await testWhatsApp(connection.credentials);
    } else {
      throw new PlatformError("پلتفرم ناشناخته", { platform, category: ERROR_CATEGORIES.INVALID_REQUEST });
    }

    const outcome = { ok: true, platform, mode, duration_ms: Date.now() - started, details: result };
    logger.info("platform connection test succeeded", {
      site_id: siteId, platform, mode, duration_ms: outcome.duration_ms,
    });
    return outcome;
  } catch (error) {
    logger.warn("platform connection test failed", {
      site_id: siteId, platform, mode, error: error.message,
      error_code: error instanceof PlatformError ? error.category : "unknown",
    });
    return { ...failure(platform, error), mode, duration_ms: Date.now() - started };
  }
}

/** Whole-client snapshot: one entry per platform the client has configured. */
export async function testClientConnections(siteId, { mode = "check" } = {}) {
  const site = await getSite(siteId);
  if (!site) throw new Error("Site not found");

  const platforms = [];
  if (site.telegram_channel_id) platforms.push("telegram");
  if (site.bale_chat_id) platforms.push("bale");
  if (config.whatsapp.enabled && site.owner_user_id) platforms.push("whatsapp");

  const results = [];
  for (const platform of platforms) {
    results.push(await testClientPlatform(siteId, platform, { mode }));
  }
  return {
    site_id: siteId,
    enabled: site.enabled,
    tested: results.length,
    results,
  };
}

/**
 * Backend-level platform status: are the shared bot credentials valid?
 * Token values are never returned — only a masked fingerprint.
 */
export async function platformHealth({ probe = false } = {}) {
  const status = {
    telegram: {
      configured: Boolean(config.telegram.token),
      token_hint: maskSecret(config.telegram.token),
      webhook_url: config.telegram.webhookUrl || "",
    },
    bale: {
      configured: Boolean(config.bale.token),
      token_hint: maskSecret(config.bale.token),
      api_base: config.bale.apiBase,
    },
    whatsapp: {
      configured: config.whatsapp.enabled,
      graph_version: config.whatsapp.graphVersion,
      // Cloud API credentials are per client, so there is nothing global to probe.
      note: "credentials are per client and stored encrypted",
    },
  };

  if (!probe) return status;

  if (status.telegram.configured) {
    try {
      const info = await getTelegramBotInfo();
      status.telegram.reachable = true;
      status.telegram.bot_username = info?.username || "";
    } catch (error) {
      status.telegram.reachable = false;
      status.telegram.error = error.message;
    }
  }
  if (status.bale.configured) {
    try {
      const info = await getBaleBotInfo();
      status.bale.reachable = true;
      status.bale.bot_username = info?.username || "";
    } catch (error) {
      status.bale.reachable = false;
      status.bale.error = error.message;
    }
  }
  return status;
}

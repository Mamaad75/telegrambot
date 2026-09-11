import TelegramBot from "node-telegram-bot-api";
import { config } from "../config.js";
import { query } from "../db/db.js";
import { PlatformError, ERROR_CATEGORIES, categorizeHttpStatus, categorizeThrown } from "./errors.js";

/**
 * Telegram publishing adapter and shared bot instance.
 *
 * Conversation handling lives in src/bot/ — this module owns the connection to
 * Telegram and the message operations the publication engine needs.
 */
let bot = null;

export function getBot() {
  if (!config.telegram.token) return null;
  if (!bot) bot = new TelegramBot(config.telegram.token);
  return bot;
}

/** Test seam: lets the suite inject a stub bot without a live token. */
export function setBotForTesting(instance) {
  bot = instance;
}

export async function setTelegramWebhook() {
  const instance = getBot();
  if (!instance || !config.telegram.webhookUrl) return false;
  await instance.setWebHook(config.telegram.webhookUrl, {
    ...(config.telegram.webhookSecretToken ? { secret_token: config.telegram.webhookSecretToken } : {}),
  });
  return true;
}

function requireBot() {
  const instance = getBot();
  if (!instance) {
    throw new PlatformError("TELEGRAM_BOT_TOKEN is not configured", {
      platform: "telegram", category: ERROR_CATEGORIES.CONFIG,
    });
  }
  return instance;
}

/**
 * node-telegram-bot-api rejects with its own error shape; this converts it into
 * the PlatformError vocabulary the publication engine and retry queue use.
 */
async function callTelegram(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    const body = error?.response?.body;
    const description = body?.description || error?.message || "Telegram request failed";
    const status = Number(body?.error_code) || Number(error?.response?.statusCode) || 0;
    const retryAfter = Number(body?.parameters?.retry_after) || 0;

    throw new PlatformError(description, {
      platform: "telegram",
      category: status ? categorizeHttpStatus(status, description) : categorizeThrown(error),
      status,
      retryAfterMs: retryAfter * 1000,
      cause: error,
    });
  }
}

function buildMarkup(buttons = []) {
  if (!buttons.length) return {};
  return { reply_markup: { inline_keyboard: [buttons] } };
}

export async function publishTelegramText(ad, chatId, formatted) {
  const instance = requireBot();
  if (!chatId) {
    throw new PlatformError("Telegram target is not configured", {
      platform: "telegram", category: ERROR_CATEGORIES.CONFIG,
    });
  }

  const text = typeof formatted === "string" ? formatted : formatted?.text || "📋 <b>آگهی</b>";
  const buttons = typeof formatted === "string" ? [] : formatted?.buttons || [];
  const markup = buildMarkup(buttons);

  if (ad.images?.length) {
    const message = await callTelegram(() => instance.sendPhoto(chatId, ad.images[0], {
      caption: text,
      parse_mode: "HTML",
      ...markup,
    }));
    return { message_ids: [message.message_id] };
  }

  const message = await callTelegram(() => instance.sendMessage(chatId, text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...markup,
  }));
  return { message_ids: [message.message_id] };
}

export async function updateTelegramPublication(publication, formatted, ad) {
  const instance = requireBot();
  const messageId = publication?.external_message_ids?.[0] || publication?.external_message_ids?.message_id;
  if (!messageId) {
    throw new PlatformError("Telegram publication has no message_id", {
      platform: "telegram", category: ERROR_CATEGORIES.CONFIG,
    });
  }

  const target = ad._telegram_target
    || ad.telegram_target
    || publication?.metadata?.telegram_target
    || (await query("SELECT telegram_channel_id FROM sites WHERE id=$1", [publication.site_id])).rows[0]?.telegram_channel_id
    || null;
  if (!target) {
    throw new PlatformError("Telegram target is missing for edit", {
      platform: "telegram", category: ERROR_CATEGORIES.CONFIG,
    });
  }

  const markup = buildMarkup(formatted?.buttons || []);
  const text = formatted?.text || "📋 <b>آگهی</b>";

  if (ad.images?.length) {
    await callTelegram(() => instance.editMessageCaption(text, {
      chat_id: target, message_id: messageId, parse_mode: "HTML", ...markup,
    }));
  } else {
    await callTelegram(() => instance.editMessageText(text, {
      chat_id: target, message_id: messageId, parse_mode: "HTML",
      disable_web_page_preview: true, ...markup,
    }));
  }
  return { message_ids: [messageId] };
}

export async function deleteTelegramPublication(publication) {
  const instance = requireBot();
  const metadata = publication?.metadata || {};
  const chatId = metadata.telegram_target
    || (await query("SELECT telegram_channel_id FROM sites WHERE id=$1", [publication.site_id])).rows[0]?.telegram_channel_id
    || null;
  if (!chatId) {
    throw new PlatformError("Telegram publication target metadata is missing", {
      platform: "telegram", category: ERROR_CATEGORIES.CONFIG,
    });
  }

  const ids = Array.isArray(publication.external_message_ids) ? publication.external_message_ids : [];
  for (const id of ids) await callTelegram(() => instance.deleteMessage(chatId, id));
}

/** Read-only check that the bot can see a configured channel. */
export async function testTelegramTarget(chatId) {
  const instance = requireBot();
  if (!chatId) {
    throw new PlatformError("Telegram target is not configured", {
      platform: "telegram", category: ERROR_CATEGORIES.CONFIG,
    });
  }
  const chat = await callTelegram(() => instance.getChat(chatId));
  return {
    ok: true,
    chat_id: chat?.id ?? chatId,
    title: chat?.title || chat?.username || "",
    type: chat?.type || "",
  };
}

export async function sendTelegramTest(chatId, text) {
  const instance = requireBot();
  const message = await callTelegram(() => instance.sendMessage(chatId, text, { parse_mode: "HTML" }));
  return { message_ids: [message.message_id] };
}

export async function getTelegramBotInfo() {
  const instance = requireBot();
  return callTelegram(() => instance.getMe());
}

export async function sendTelegramMessage(chatId, text, options = {}) {
  const instance = requireBot();
  return callTelegram(() => instance.sendMessage(chatId, text, options));
}

export { callTelegram };

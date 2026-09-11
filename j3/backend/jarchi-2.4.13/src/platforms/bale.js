import { config } from "../config.js";
import {
  PlatformError, ERROR_CATEGORIES, fetchJson, categorizeHttpStatus, retryAfterMsFromHeaders,
} from "./errors.js";

/** Bale speaks a Telegram-Bot-API-shaped protocol on its own host. */
async function call(method, payload = {}) {
  if (!config.bale.token) {
    throw new PlatformError("BALE_BOT_TOKEN is not configured", { platform: "bale", category: ERROR_CATEGORIES.CONFIG });
  }

  const { response, data } = await fetchJson(`${config.bale.apiBase}/bot${config.bale.token}/${method}`, {
    platform: "bale",
    timeoutMs: config.bale.apiTimeoutMs,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok || data?.ok === false) {
    const description = data?.description || `Bale ${method} failed`;
    throw new PlatformError(description, {
      platform: "bale",
      category: categorizeHttpStatus(response.status, description),
      status: response.status,
      retryAfterMs: retryAfterMsFromHeaders(response, data),
    });
  }
  return data.result ?? data;
}

export async function setBaleWebhook() {
  if (!config.bale.token || !config.bale.webhookUrl) return false;
  await call("setWebhook", { url: config.bale.webhookUrl });
  return true;
}

export async function deleteBaleWebhook(dropPendingUpdates = false) {
  if (!config.bale.token) return false;
  await call("deleteWebhook", { drop_pending_updates: Boolean(dropPendingUpdates) });
  return true;
}

export async function sendBaleMessage(chatId, text, options = {}) {
  return call("sendMessage", { chat_id: chatId, text, ...options });
}

export async function answerBaleCallbackQuery(callbackQueryId, options = {}) {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...options });
}

export async function getBaleWebhookInfo() {
  return call("getWebhookInfo");
}

export async function publishBale(ad, chatId, formatted) {
  if (!chatId) {
    throw new PlatformError("Bale target is not configured", { platform: "bale", category: ERROR_CATEGORIES.CONFIG });
  }
  const text = typeof formatted === "string" ? formatted : formatted?.text || "📋 آگهی";
  const buttons = typeof formatted === "string" ? [] : formatted?.buttons || [];
  const replyMarkup = buttons.length ? { inline_keyboard: [buttons] } : undefined;

  let result;
  if (ad?.images?.length) {
    result = await call("sendPhoto", {
      chat_id: chatId,
      photo: ad.images[0],
      caption: text.slice(0, 1024),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  } else {
    result = await call("sendMessage", {
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }
  return { message_ids: [result?.message_id].filter(Boolean) };
}

export async function deleteBalePublication(publication) {
  const target = publication?.metadata?.bale_target;
  if (!target) {
    throw new PlatformError("Bale target metadata is missing", { platform: "bale", category: ERROR_CATEGORIES.CONFIG });
  }
  const ids = Array.isArray(publication.external_message_ids) ? publication.external_message_ids : [];
  for (const messageId of ids) await call("deleteMessage", { chat_id: target, message_id: messageId });
}

/** Read-only reachability check for a configured Bale target. */
export async function testBaleTarget(chatId) {
  if (!chatId) {
    throw new PlatformError("Bale target is not configured", { platform: "bale", category: ERROR_CATEGORIES.CONFIG });
  }
  const chat = await call("getChat", { chat_id: chatId });
  return {
    ok: true,
    chat_id: chat?.id ?? chatId,
    title: chat?.title || chat?.username || "",
    type: chat?.type || "",
  };
}

/** Sends a visible probe message; used by the explicit "test send" action. */
export async function sendBaleTest(chatId, text) {
  const result = await call("sendMessage", { chat_id: chatId, text });
  return { message_ids: [result?.message_id].filter(Boolean) };
}

export async function getBaleBotInfo() {
  return call("getMe");
}

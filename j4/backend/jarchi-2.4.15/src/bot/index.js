import { getBot, setTelegramWebhook } from "../platforms/telegram.js";
import { logger } from "../logger.js";
import {
  handleStart, handlePanel, handleContactCallback, handlePlansCallback,
  handleBuyCallback, handlePreCheckout, handleSuccessfulPayment,
} from "./customer.js";
import { handleAdminCommand, handleAdminCallback, handleAdminMessage, handleAdminCancel } from "./admin/index.js";

/**
 * Wires the Telegram bot: customer commands, the admin interface, payments.
 *
 * Handler order for callbacks: admin callbacks (prefixed `a:`) are matched
 * first and are authorized individually; everything else falls through to the
 * customer handlers.
 */
export function setupTelegramBot(publicBaseUrl) {
  const bot = getBot();
  if (!bot) {
    logger.warn("telegram bot not configured; bot interface disabled", { reason: "missing TELEGRAM_BOT_TOKEN" });
    return null;
  }

  bot.onText(/^\/start/i, async (msg) => {
    try {
      await handleStart(bot, msg, publicBaseUrl);
    } catch (error) {
      logger.error("telegram /start failed", { error, telegram_user_id: msg.from?.id });
    }
  });

  bot.onText(/^\/panel/i, async (msg) => {
    try {
      await handlePanel(bot, msg, publicBaseUrl);
    } catch (error) {
      logger.error("telegram /panel failed", { error, telegram_user_id: msg.from?.id });
    }
  });

  bot.onText(/^\/admin/i, async (msg) => {
    try {
      await handleAdminCommand(bot, msg);
    } catch (error) {
      logger.error("telegram /admin failed", { error, telegram_user_id: msg.from?.id });
    }
  });

  bot.onText(/^\/cancel/i, async (msg) => {
    try {
      await handleAdminCancel(bot, msg);
    } catch (error) {
      logger.error("telegram /cancel failed", { error, telegram_user_id: msg.from?.id });
    }
  });

  bot.on("callback_query", async (callbackQuery) => {
    try {
      const data = String(callbackQuery.data || "");

      if (await handleAdminCallback(bot, callbackQuery)) return;

      if (data.startsWith("contact:")) {
        await handleContactCallback(bot, callbackQuery);
        return;
      }
      if (data === "plans") {
        await handlePlansCallback(bot, callbackQuery);
      } else if (data.startsWith("buy:")) {
        await handleBuyCallback(bot, callbackQuery, data.slice(4));
      }
      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      logger.error("telegram callback failed", { error, callback: callbackQuery.data });
      try {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: String(error.message).slice(0, 180),
          show_alert: true,
        });
      } catch { /* the query may already be answered or expired */ }
    }
  });

  bot.on("pre_checkout_query", (preCheckoutQuery) => handlePreCheckout(bot, preCheckoutQuery));

  bot.on("message", async (msg) => {
    try {
      if (msg.successful_payment) {
        await handleSuccessfulPayment(bot, msg);
        return;
      }
      // Plain text only reaches the admin flows when the sender has one open.
      await handleAdminMessage(bot, msg);
    } catch (error) {
      logger.error("telegram message handling failed", { error, telegram_user_id: msg.from?.id });
    }
  });

  logger.info("telegram bot handlers registered", {});
  return bot;
}

export { getBot, setTelegramWebhook };

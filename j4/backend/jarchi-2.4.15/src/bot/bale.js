import {
  answerBaleCallbackQuery,
  getBaleBotInfo,
  sendBaleMessage,
} from "../platforms/bale.js";
import { query } from "../db/db.js";
import { upsertIdentity, createSession } from "../services/users.js";
import { ensureTrial } from "../services/billing.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { completeLinkFromBot } from "../services/unifiedIdentity.js";

const panelUrl = (base, token) => `${base}/app/bale.html?platform=bale&session=${encodeURIComponent(token)}`;

export async function handleBaleStart(update, publicBaseUrl) {
  const msg = update?.message;
  const from = msg?.from;
  const chatId = msg?.chat?.id;
  if (!from || chatId == null) return false;

  const startPayload = String(msg?.text || "").trim().split(/\s+/, 2)[1] || "";
  if (startPayload.startsWith("link_")) {
    try {
      const linked = await completeLinkFromBot("bale", from.id, {
        display_name: [from.first_name, from.last_name].filter(Boolean).join(" "),
        username: from.username || "",
      }, startPayload);
      const token = await createSession(linked.userId, "bale", 24);
      await sendBaleMessage(chatId, "✅ حساب بله شما با حساب جارچی متصل شد. حالا همان اشتراک، سایت‌ها، تیکت‌ها و دسترسی‌ها را در این پلتفرم هم دارید.", {
        reply_markup: { inline_keyboard: [[{ text: "🚀 باز کردن پنل جارچی", web_app: { url: panelUrl(publicBaseUrl, token) } }]] },
      });
      return true;
    } catch (error) {
      logger.error("bale identity link failed", { error, bale_user_id: from?.id });
      await sendBaleMessage(chatId, `❌ ${String(error.message || "اتصال حساب انجام نشد")}`);
      return true;
    }
  }

  const user = await upsertIdentity("bale", from.id, {
    display_name: [from.first_name, from.last_name].filter(Boolean).join(" "),
    username: from.username || "",
  });


  const existed = await query("SELECT 1 FROM subscriptions WHERE user_id=$1 LIMIT 1", [user.id]);
  let text = `👋 سلام ${from.first_name || ""}!\n\nبه <b>جارچی</b> در بله خوش آمدی.`;
  if (!existed.rowCount && config.autoTrialOnStart) {
    await ensureTrial(user.id);
    text += "\n🎁 اشتراک آزمایشی ۷ روزه برایت فعال شد.";
  }

  const token = await createSession(user.id, "bale", 24);
  await sendBaleMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 پنل کاربری", web_app: { url: panelUrl(publicBaseUrl, token) } }],
      ],
    },
  });
  return true;
}

export async function handleBalePanel(update, publicBaseUrl) {
  const msg = update?.message;
  const from = msg?.from;
  const chatId = msg?.chat?.id;
  if (!from || chatId == null) return false;

  const user = await upsertIdentity("bale", from.id, {
    display_name: [from.first_name, from.last_name].filter(Boolean).join(" "),
    username: from.username || "",
  });

  const token = await createSession(user.id, "bale", 24);
  await sendBaleMessage(chatId, "👤 پنل کاربری جارچی", {
    reply_markup: {
      inline_keyboard: [[{ text: "🚀 باز کردن پنل", web_app: { url: panelUrl(publicBaseUrl, token) } }]],
    },
  });
  return true;
}

export async function handleBaleCallback(update) {
  const callback = update?.callback_query;
  if (!callback?.id) return false;
  await answerBaleCallbackQuery(callback.id);
  return true;
}

export async function getBaleCustomerBotInfo() {
  return getBaleBotInfo();
}

export async function processBaleUpdate(update, publicBaseUrl) {
  const text = String(update?.message?.text || "").trim();
  if (/^\/start(?:@[^\s]+)?(?:\s|$)/i.test(text)) return handleBaleStart(update, publicBaseUrl);
  if (/^\/panel(?:@[^\s]+)?(?:\s|$)/i.test(text)) return handleBalePanel(update, publicBaseUrl);
  if (update?.callback_query) return handleBaleCallback(update);
  return false;
}

export function logBaleBotReady(info) {
  logger.info("bale customer bot ready", {
    bale_bot_id: info?.id,
    bale_bot_username: info?.username,
  });
}

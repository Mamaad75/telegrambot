import { PERMISSIONS, can } from "../../core/rbac.js";
import { getState, setState, advanceState, clearState } from "../state.js";
import { auditBot } from "../guards.js";
import { cancelFlowMenu, confirmMenu, clientMenu } from "../keyboards.js";
import { escapeHtml, faDate } from "../format.js";
import { provisionClient, updateClient, listClients } from "../../services/clients.js";
import { extendSubscription, getSubscription } from "../../services/billing.js";
import { listUsers } from "../../services/usersAdmin.js";
import { renderClientList, renderUserList, renderClientDetail } from "./render.js";
import {
  requireUrl, optionalTelegramTarget, optionalBaleTarget, optionalTelegramUserId, requireString,
} from "../../middleware/validate.js";
import { config } from "../../config.js";
import { replyTicket } from "../../services/wordpressTickets.js";
import { createAnnouncement, createProduct } from "../../services/wordpressContent.js";
import { requireFeature } from "../../services/entitlements.js";

/**
 * Multi-step admin flows.
 *
 * Each step validates its input with the same validators the HTTP API uses, so
 * a value accepted here cannot be one the API would reject. State lives in the
 * database (src/bot/state.js): a restart mid-flow resumes at the same step, and
 * an abandoned flow expires instead of capturing the admin's chat forever.
 */

const NONE = new Set(["ندارد", "-", "خالی", "skip", "none"]);
const isNone = (value) => NONE.has(String(value).trim().toLowerCase());

export const FLOW_PERMISSIONS = Object.freeze({
  client_create: PERMISSIONS.CLIENTS_CREATE,
  client_search: PERMISSIONS.CLIENTS_VIEW,
  client_edit: PERMISSIONS.CLIENTS_UPDATE,
  client_target: PERMISSIONS.PLATFORMS_UPDATE,
  user_search: PERMISSIONS.USERS_VIEW,
  subscription_extend: PERMISSIONS.SUBSCRIPTIONS_MANAGE,
  ticket_reply: PERMISSIONS.TICKETS_REPLY,
  announcement_create: PERMISSIONS.TICKETS_CREATE,
  product_create: PERMISSIONS.TICKETS_CREATE,
});

export async function startFlow(bot, chatId, actor, flow, { step, prompt, data = {} }) {
  await setState(actor.telegram_user_id, chatId, flow, step, data);
  await bot.sendMessage(chatId, prompt, { parse_mode: "HTML", ...cancelFlowMenu() });
}

export async function cancelFlow(bot, chatId, actor) {
  const cleared = await clearState(actor.telegram_user_id, chatId);
  await bot.sendMessage(chatId, cleared ? "✖️ عملیات لغو شد." : "عملیات فعالی وجود ندارد.");
}

const EDITABLE_FIELDS = {
  name: { label: "نام کلاینت", prompt: "نام جدید کلاینت را بفرستید:" },
  url: { label: "آدرس وردپرس", prompt: "آدرس جدید سایت را بفرستید (با https://):" },
  owner: { label: "مالک", prompt: "Telegram ID مالک را بفرستید یا «ندارد»:" },
};

export const EDIT_FIELD_KEYS = Object.keys(EDITABLE_FIELDS);
export const editFieldLabel = (field) => EDITABLE_FIELDS[field]?.label || field;
export const editFieldPrompt = (field) => EDITABLE_FIELDS[field]?.prompt || "مقدار جدید را بفرستید:";

/**
 * Handles one text message while a flow is active.
 * Returns true when the message was consumed by a flow.
 */
export async function handleFlowMessage(bot, msg, actor) {
  const chatId = String(msg.chat.id);
  const state = await getState(actor.telegram_user_id, chatId);
  if (!state) return false;

  const text = String(msg.text || "").trim();
  if (!text) return false;

  // A flow the admin no longer has rights for (role changed mid-flow) stops here.
  const permission = FLOW_PERMISSIONS[state.flow];
  if (permission && !can(actor, permission)) {
    await clearState(actor.telegram_user_id, chatId);
    await bot.sendMessage(chatId, "⛔ سطح دسترسی شما برای ادامه این عملیات کافی نیست.");
    return true;
  }

  if (["لغو", "/cancel", "cancel"].includes(text)) {
    await cancelFlow(bot, chatId, actor);
    return true;
  }

  try {
    switch (state.flow) {
      case "client_create": return await clientCreateStep(bot, chatId, actor, state, text);
      case "client_search": return await clientSearchStep(bot, chatId, actor, text);
      case "client_edit": return await clientEditStep(bot, chatId, actor, state, text);
      case "client_target": return await clientTargetStep(bot, chatId, actor, state, text);
      case "user_search": return await userSearchStep(bot, chatId, actor, text);
      case "subscription_extend": return await subscriptionExtendStep(bot, chatId, actor, state, text);
      case "ticket_reply": return await ticketReplyStep(bot, chatId, actor, state, text);
      case "announcement_create": return await announcementCreateStep(bot, chatId, actor, state, text);
      case "product_create": return await productCreateStep(bot, chatId, actor, state, text);
      default:
        await clearState(actor.telegram_user_id, chatId);
        return false;
    }
  } catch (error) {
    // Validation failures keep the flow alive so the admin can correct the value.
    await bot.sendMessage(chatId, `⚠️ ${escapeHtml(error.message)}\n\nدوباره تلاش کنید یا «لغو» بفرستید.`, { parse_mode: "HTML" });
    return true;
  }
}

/* --------------------------- create client --------------------------- */

async function clientCreateStep(bot, chatId, actor, state, text) {
  const data = { ...(state.data || {}) };

  if (state.step === "name") {
    data.name = requireString(text, "نام", { max: 190 });
    await advanceState(actor.telegram_user_id, chatId, "url", data);
    await bot.sendMessage(chatId, "۲/۶ آدرس سایت وردپرس مشتری را بفرستید (با https://):", cancelFlowMenu());
    return true;
  }

  if (state.step === "url") {
    data.wordpress_url = requireUrl(text, "آدرس سایت");
    await advanceState(actor.telegram_user_id, chatId, "telegram", data);
    await bot.sendMessage(chatId, "۳/۶ هدف تلگرام را بفرستید (@channel یا لینک t.me یا chat id) یا «ندارد»:", cancelFlowMenu());
    return true;
  }

  if (state.step === "telegram") {
    data.telegram_channel_id = isNone(text) ? "" : optionalTelegramTarget(text, "هدف تلگرام");
    await advanceState(actor.telegram_user_id, chatId, "bale", data);
    await bot.sendMessage(chatId, "۴/۶ هدف بله را بفرستید (@channel یا chat id) یا «ندارد»:", cancelFlowMenu());
    return true;
  }

  if (state.step === "bale") {
    data.bale_chat_id = isNone(text) ? "" : optionalBaleTarget(text, "هدف بله");
    await advanceState(actor.telegram_user_id, chatId, "owner", data);
    await bot.sendMessage(chatId, "۵/۶ Telegram ID مالک/مدیر مشتری را بفرستید یا «ندارد»:", cancelFlowMenu());
    return true;
  }

  if (state.step === "owner") {
    data.owner_telegram_id = isNone(text) ? "" : optionalTelegramUserId(text, "شناسه تلگرام مالک");
    await advanceState(actor.telegram_user_id, chatId, "confirm", data);
    await bot.sendMessage(chatId, [
      "۶/۶ <b>تایید ساخت کلاینت</b>",
      "",
      `نام: ${escapeHtml(data.name)}`,
      `سایت: ${escapeHtml(data.wordpress_url)}`,
      `تلگرام: ${escapeHtml(data.telegram_channel_id || "ندارد")}`,
      `بله: ${escapeHtml(data.bale_chat_id || "ندارد")}`,
      `مالک: ${escapeHtml(data.owner_telegram_id || "ندارد")}`,
    ].join("\n"), { parse_mode: "HTML", ...confirmMenu("a:cl:newy", "a:flow:cancel") });
    return true;
  }

  if (state.step === "confirm") {
    await bot.sendMessage(chatId, "برای ثبت، دکمه «تایید» را بزنید یا «لغو» بفرستید.");
    return true;
  }

  await clearState(actor.telegram_user_id, chatId);
  return false;
}

/** Called by the confirm button, not by a text message. */
export async function commitClientCreate(bot, chatId, actor) {
  const state = await getState(actor.telegram_user_id, chatId);
  if (!state || state.flow !== "client_create" || state.step !== "confirm") {
    await bot.sendMessage(chatId, "عملیات ساخت کلاینت پیدا نشد یا منقضی شده است.");
    return;
  }

  const client = await provisionClient(state.data);
  await clearState(actor.telegram_user_id, chatId);
  await auditBot(actor, "client.create", {
    targetType: "site", targetId: client.id,
    metadata: { name: state.data.name, wordpress_url: state.data.wordpress_url },
  });

  await bot.sendMessage(chatId, [
    "✅ <b>کلاینت ساخته شد</b>",
    "",
    `Site ID: <code>${escapeHtml(client.id)}</code>`,
    `Webhook URL: <code>${escapeHtml(client.webhook_url || `${config.publicBaseUrl}/webhook`)}</code>`,
    `Webhook Secret: <code>${escapeHtml(client.webhook_secret)}</code>`,
    "",
    client.trial?.expires_at ? `🎁 اشتراک آزمایشی تا ${faDate(client.trial.expires_at)}` : "",
    "",
    "<i>این رمز فقط همین یک‌بار نمایش داده می‌شود؛ آن را به مشتری بدهید.</i>",
  ].filter(Boolean).join("\n"), { parse_mode: "HTML", ...clientMenu(actor, client.id, { enabled: true }) });
}

/* ------------------------------ search ------------------------------ */

async function clientSearchStep(bot, chatId, actor, text) {
  const result = await listClients({ q: text, page: 1, page_size: 8 });
  await clearState(actor.telegram_user_id, chatId);

  const keyboard = result.items.map((client) => [{
    text: `${client.enabled ? "✅" : "⛔"} ${client.name || client.id}`.slice(0, 60),
    callback_data: `a:cl:v:${client.id}`,
  }]);
  keyboard.push([{ text: "🏠 منو", callback_data: "a:menu" }]);

  await bot.sendMessage(chatId, renderClientList(result, { title: `🔍 نتیجه جست‌وجو: ${escapeHtml(text)}` }), {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard },
  });
  return true;
}

async function userSearchStep(bot, chatId, actor, text) {
  const result = await listUsers({ q: text, page: 1, page_size: 8 });
  await clearState(actor.telegram_user_id, chatId);

  const keyboard = result.items.map((user) => [{
    text: `${user.display_name || user.username || `#${user.id}`}`.slice(0, 60),
    callback_data: `a:usr:v:${user.id}`,
  }]);
  keyboard.push([{ text: "🏠 منو", callback_data: "a:menu" }]);

  await bot.sendMessage(chatId, renderUserList(result), {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard },
  });
  return true;
}

/* ---------------------------- client edit ---------------------------- */

async function clientEditStep(bot, chatId, actor, state, text) {
  const { site_id: siteId, field } = state.data || {};
  const patch = {};

  if (field === "name") patch.name = requireString(text, "نام", { max: 190 });
  else if (field === "url") patch.wordpress_url = requireUrl(text, "آدرس سایت");
  else if (field === "owner") patch.owner_telegram_id = isNone(text) ? "" : optionalTelegramUserId(text, "شناسه تلگرام مالک");
  else {
    await clearState(actor.telegram_user_id, chatId);
    return false;
  }

  const client = await updateClient(siteId, patch);
  await clearState(actor.telegram_user_id, chatId);
  await auditBot(actor, "client.update", { targetType: "site", targetId: siteId, metadata: { fields: Object.keys(patch) } });

  await bot.sendMessage(chatId, `✅ ${escapeHtml(editFieldLabel(field))} به‌روزرسانی شد.`, { parse_mode: "HTML" });
  await bot.sendMessage(chatId, renderClientDetail(client), {
    parse_mode: "HTML",
    ...clientMenu(actor, siteId, { enabled: client.enabled }),
  });
  return true;
}

/* --------------------------- platform target --------------------------- */

async function clientTargetStep(bot, chatId, actor, state, text) {
  const { site_id: siteId, platform } = state.data || {};
  const patch = {};

  if (platform === "telegram") patch.telegram_channel_id = isNone(text) ? "" : optionalTelegramTarget(text, "هدف تلگرام");
  else if (platform === "bale") patch.bale_chat_id = isNone(text) ? "" : optionalBaleTarget(text, "هدف بله");
  else {
    await clearState(actor.telegram_user_id, chatId);
    return false;
  }

  const client = await updateClient(siteId, patch);
  await clearState(actor.telegram_user_id, chatId);
  await auditBot(actor, "client.platform.update", {
    targetType: "site", targetId: siteId, metadata: { platform, configured: Boolean(Object.values(patch)[0]) },
  });

  await bot.sendMessage(chatId, renderClientDetail(client), {
    parse_mode: "HTML",
    ...clientMenu(actor, siteId, { enabled: client.enabled }),
  });
  return true;
}

/* ------------------------- subscription extend ------------------------- */

async function subscriptionExtendStep(bot, chatId, actor, state, text) {
  const days = Number(String(text).replace(/[^\d]/g, ""));
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    throw new Error("تعداد روز باید عددی بین ۱ تا ۳۶۵۰ باشد");
  }

  const subscriptionId = state.data?.subscription_id;
  const subscription = await extendSubscription(subscriptionId, days);
  await clearState(actor.telegram_user_id, chatId);

  if (!subscription) {
    await bot.sendMessage(chatId, "اشتراک یافت نشد.");
    return true;
  }

  await auditBot(actor, "subscription.extend", {
    targetType: "subscription", targetId: subscriptionId, metadata: { days },
  });
  const full = await getSubscription(subscriptionId);
  await bot.sendMessage(chatId, [
    "✅ اشتراک تمدید شد.",
    `کاربر: ${escapeHtml(full?.display_name || "—")}`,
    `پلن: ${escapeHtml(full?.plan_name || "—")}`,
    `انقضای جدید: ${faDate(subscription.expires_at)}`,
  ].join("\n"), { parse_mode: "HTML" });
  return true;
}

/* -------------------------- ticket/content flows -------------------------- */

async function ticketReplyStep(bot, chatId, actor, state, text) {
  const data = { ...(state.data || {}) };
  if (state.step === "message") {
    if (text.length < 2) throw new Error("متن پاسخ خیلی کوتاه است.");
    await requireFeature(data.site.owner_user_id, "remote_tickets");
    await replyTicket(data.site, data.ticket_id, { body: text, agent_name: actor.display_name || "پشتیبان جارچی" });
    await clearState(actor.telegram_user_id, chatId);
    await bot.sendMessage(chatId, `✅ پاسخ تیکت #${data.ticket_id} ارسال شد.`);
    return true;
  }
  await clearState(actor.telegram_user_id, chatId);
  return false;
}

async function announcementCreateStep(bot, chatId, actor, state, text) {
  const data = { ...(state.data || {}) };
  if (state.step === "title") {
    data.title = requireString(text, "عنوان", { maxLength: 190 });
    await advanceState(actor.telegram_user_id, chatId, "content", data);
    await bot.sendMessage(chatId, "۲/۲ متن اطلاعیه را بفرستید:");
    return true;
  }
  if (state.step === "content") {
    data.content = text.slice(0, 10000);
    await requireFeature(data.site.owner_user_id, "remote_announcements");
    await createAnnouncement(data.site, { title: data.title, content: data.content, placement: "page" });
    await clearState(actor.telegram_user_id, chatId);
    await bot.sendMessage(chatId, "✅ اطلاعیه در سایت ایجاد شد.");
    return true;
  }
  await clearState(actor.telegram_user_id, chatId);
  return false;
}

async function productCreateStep(bot, chatId, actor, state, text) {
  const data = { ...(state.data || {}) };
  if (state.step === "name") {
    data.name = requireString(text, "نام محصول", { maxLength: 190 });
    await advanceState(actor.telegram_user_id, chatId, "description", data);
    await bot.sendMessage(chatId, "۲/۴ توضیحات محصول را بفرستید:");
    return true;
  }
  if (state.step === "description") {
    data.description = text.slice(0, 10000);
    await advanceState(actor.telegram_user_id, chatId, "price", data);
    await bot.sendMessage(chatId, "۳/۴ قیمت را بفرستید یا «ندارد»:");
    return true;
  }
  if (state.step === "price") {
    data.price = isNone(text) ? "" : text.replace(/[,\s]/g, "");
    await advanceState(actor.telegram_user_id, chatId, "confirm", data);
    await bot.sendMessage(chatId, `۴/۴ تایید محصول:\n\n<b>${escapeHtml(data.name)}</b>\n${escapeHtml(data.price || "بدون قیمت")}`, { parse_mode: "HTML", ...confirmMenu("a:flow:product_commit", "a:flow:cancel") });
    return true;
  }
  await clearState(actor.telegram_user_id, chatId);
  return false;
}

export async function commitProductCreate(bot, chatId, actor) {
  const state = await getState(actor.telegram_user_id, chatId);
  if (!state || state.flow !== "product_create" || state.step !== "confirm") {
    await bot.sendMessage(chatId, "عملیات محصول پیدا نشد.");
    return;
  }
  await requireFeature(state.data.site.owner_user_id, "remote_products");
  await createProduct(state.data.site, {
    name: state.data.name,
    description: state.data.description,
    price: state.data.price || "",
    status: "draft",
  });
  await clearState(actor.telegram_user_id, chatId);
  await bot.sendMessage(chatId, "✅ پیش‌نویس محصول در WooCommerce ساخته شد.");
}

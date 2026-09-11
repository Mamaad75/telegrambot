import { PERMISSIONS, can } from "../../core/rbac.js";
import { authorize, auditBot } from "../guards.js";
import { getState, clearState } from "../state.js";
import {
  mainMenu, clientMenu, platformMenu, confirmMenu, pager, backTo,
} from "../keyboards.js";
import { escapeHtml, faNumber, platformLabel, clamp } from "../format.js";
import {
  renderDashboard, renderClientList, renderClientDetail, renderWebhookDiagnostics, renderFields,
  renderPublicationList, renderPublicationDetail, renderUserList, renderUserDetail,
  renderSubscriptionList, renderInvoiceList, renderAuditList, renderPlatformHealth, renderSettings,
} from "./render.js";
import {
  startFlow, cancelFlow, handleFlowMessage, commitClientCreate,
  editFieldPrompt, editFieldLabel, EDIT_FIELD_KEYS, commitProductCreate,
} from "./flows.js";
import {
  listClients, getClientDetail, setClientEnabled, rotateWebhookSecret, listWebhookEvents,
} from "../../services/clients.js";
import { listFieldCatalog } from "../../services/fields.js";
import { listPublications, getPublication, isRetryEligible } from "../../services/publications.js";
import { listUsers, getUserDetail, setUserStatus, revokeUserSessions } from "../../services/usersAdmin.js";
import { listSubscriptions, listInvoices } from "../../services/billing.js";
import { listAudit } from "../../services/audit.js";
import { dashboardSummary } from "../../services/stats.js";
import { platformHealth, testClientPlatform } from "../../services/diagnostics.js";
import { listRetries, runRetryWorker, enqueueRetry } from "../../services/retry.js";
import { query } from "../../db/db.js";
import { upsertIdentity, createSession } from "../../services/users.js";
import { config } from "../../config.js";
import { decryptText } from "../../utils/security.js";
import { logger } from "../../logger.js";
import { listTickets, getTicket, setTicketStatus } from "../../services/wordpressTickets.js";

/**
 * Telegram admin interface.
 *
 * Navigation is inline-keyboard driven; text prompts are only used for the
 * values a keyboard cannot express (names, URLs, channel ids, day counts), and
 * those run through the durable flow state in src/bot/state.js.
 *
 * Authorization rule for this whole module: callback data names an action, and
 * `authorize()` re-checks the pressing admin's permission for it on every press.
 */

const PLATFORM_CODES = Object.freeze({ t: "telegram", b: "bale", w: "whatsapp" });
const PAGE_SIZE = 6;

async function respond(bot, ctx, text, keyboard = {}) {
  const options = { parse_mode: "HTML", disable_web_page_preview: true, ...keyboard };
  try {
    await bot.editMessageText(clamp(text), {
      chat_id: ctx.chatId,
      message_id: ctx.messageId,
      ...options,
    });
  } catch {
    // The message may be unchanged or too old to edit; fall back to a new one.
    await bot.sendMessage(ctx.chatId, clamp(text), options);
  }
}

/* --------------------------- route definitions --------------------------- */

const routes = new Map();
const route = (key, permission, run) => routes.set(key, { permission, run });

route("menu", null, async (bot, ctx) => {
  await respond(bot, ctx, adminHeader(ctx.actor), mainMenu(ctx.actor));
});

function adminHeader(actor) {
  return [
    "🛠 <b>مدیریت جارچی</b>",
    "",
    `کاربر: <b>${escapeHtml(actor.display_name || actor.username)}</b>`,
    `نقش: ${escapeHtml(actor.role)}`,
    "",
    "یک بخش را انتخاب کنید:",
  ].join("\n");
}

route("dash", PERMISSIONS.DASHBOARD_VIEW, async (bot, ctx) => {
  const summary = await dashboardSummary();
  const quick = [
    can(ctx.actor, PERMISSIONS.PUBLICATIONS_VIEW) ? [{ text: "❌ انتشارهای ناموفق", callback_data: "a:pub:f:1" }] : [],
    can(ctx.actor, PERMISSIONS.CLIENTS_VIEW) ? [{ text: "🌐 کلاینت‌ها", callback_data: "a:cl:l:1" }] : [],
    [backTo("a:menu", "🏠 منو")],
  ].filter((row) => row.length);
  await respond(bot, ctx, renderDashboard(summary), { reply_markup: { inline_keyboard: quick } });
});

/* ------------------------------- clients ------------------------------- */

route("cl", PERMISSIONS.CLIENTS_VIEW, async (bot, ctx) => {
  const [action, ...args] = ctx.args;

  if (action === "l") {
    const page = Number(args[0]) || 1;
    const result = await listClients({ page, page_size: PAGE_SIZE });
    const keyboard = result.items.map((client) => [{
      text: `${client.enabled ? "✅" : "⛔"} ${client.name || client.id}`.slice(0, 60),
      callback_data: `a:cl:v:${client.id}`,
    }]);

    const navigation = pager("cl", page, result.pagination.has_next, result.pagination.has_previous);
    if (navigation.length) keyboard.push(navigation);
    const tools = [];
    if (can(ctx.actor, PERMISSIONS.CLIENTS_CREATE)) tools.push({ text: "➕ کلاینت جدید", callback_data: "a:cl:new" });
    tools.push({ text: "🔍 جست‌وجو", callback_data: "a:cl:search" });
    keyboard.push(tools);
    keyboard.push([backTo("a:menu", "🏠 منو")]);

    return respond(bot, ctx, renderClientList(result), { reply_markup: { inline_keyboard: keyboard } });
  }

  if (action === "v") {
    const client = await getClientDetail(args.join(":"));
    if (!client) return respond(bot, ctx, "کلاینت یافت نشد.", mainMenu(ctx.actor));
    return respond(bot, ctx, renderClientDetail(client), clientMenu(ctx.actor, client.id, { enabled: client.enabled }));
  }

  if (action === "new") {
    if (!can(ctx.actor, PERMISSIONS.CLIENTS_CREATE)) return ctx.deny();
    await startFlow(bot, ctx.chatId, ctx.actor, "client_create", {
      step: "name",
      prompt: "➕ <b>ساخت کلاینت جدید</b>\n\n۱/۶ نام مشتری یا برند را بفرستید:",
    });
    return undefined;
  }

  if (action === "newy") {
    if (!can(ctx.actor, PERMISSIONS.CLIENTS_CREATE)) return ctx.deny();
    return commitClientCreate(bot, ctx.chatId, ctx.actor);
  }

  if (action === "search") {
    await startFlow(bot, ctx.chatId, ctx.actor, "client_search", {
      step: "term",
      prompt: "🔍 نام، آدرس سایت یا Site ID را بفرستید:",
    });
    return undefined;
  }

  if (action === "pub") {
    if (!can(ctx.actor, PERMISSIONS.PUBLICATIONS_VIEW)) return ctx.deny();
    const siteId = args.join(":");
    const result = await listPublications({ site_id: siteId, page: 1, page_size: PAGE_SIZE });
    return respond(bot, ctx, renderPublicationList(result, { title: `📢 انتشارهای ${escapeHtml(siteId)}` }), {
      reply_markup: { inline_keyboard: [[backTo(`a:cl:v:${siteId}`, "⬅️ کلاینت"), backTo("a:menu", "🏠 منو")]] },
    });
  }

  if (action === "fld") {
    if (!can(ctx.actor, PERMISSIONS.FIELDS_VIEW)) return ctx.deny();
    const siteId = args.join(":");
    const client = await getClientDetail(siteId);
    if (!client) return respond(bot, ctx, "کلاینت یافت نشد.", mainMenu(ctx.actor));
    const fields = await listFieldCatalog(siteId);
    return respond(bot, ctx, renderFields(client, fields), {
      reply_markup: { inline_keyboard: [[backTo(`a:cl:v:${siteId}`, "⬅️ کلاینت"), backTo("a:menu", "🏠 منو")]] },
    });
  }

  if (action === "wh") {
    if (!can(ctx.actor, PERMISSIONS.WEBHOOKS_VIEW)) return ctx.deny();
    const siteId = args.join(":");
    const client = await getClientDetail(siteId);
    if (!client) return respond(bot, ctx, "کلاینت یافت نشد.", mainMenu(ctx.actor));
    const events = await listWebhookEvents(siteId, { page: 1, page_size: 5 });
    return respond(bot, ctx, renderWebhookDiagnostics(client, events.items), {
      reply_markup: { inline_keyboard: [[backTo(`a:cl:v:${siteId}`, "⬅️ کلاینت"), backTo("a:menu", "🏠 منو")]] },
    });
  }

  if (action === "pf") {
    const siteId = args.join(":");
    const client = await getClientDetail(siteId);
    if (!client) return respond(bot, ctx, "کلاینت یافت نشد.", mainMenu(ctx.actor));
    const body = [
      `📡 <b>پلتفرم‌های ${escapeHtml(client.name || client.id)}</b>`,
      "",
      `تلگرام: ${client.telegram_channel_id ? `<code>${escapeHtml(client.telegram_channel_id)}</code>` : "پیکربندی نشده"}`,
      `بله: ${client.bale_chat_id ? `<code>${escapeHtml(client.bale_chat_id)}</code>` : "پیکربندی نشده"}`,
      `واتس‌اپ: ${config.whatsapp.enabled ? "فعال (اعتبارنامه سمت مالک)" : "غیرفعال در این نصب"}`,
      "",
      ...client.platform_stats.map((row) => `• ${platformLabel(row.platform)}: ✅ ${faNumber(row.published)} / ❌ ${faNumber(row.failed)}`),
      "",
      "<i>توکن ربات‌ها سمت بک‌اند است و هرگز نمایش داده نمی‌شود.</i>",
    ].join("\n");
    return respond(bot, ctx, body, platformMenu(ctx.actor, siteId));
  }

  if (action === "tc" || action === "ts" || action === "tsy") {
    if (!can(ctx.actor, PERMISSIONS.PLATFORMS_TEST)) return ctx.deny();
    const platform = PLATFORM_CODES[args[0]];
    const siteId = args.slice(1).join(":");
    if (!platform) return respond(bot, ctx, "پلتفرم نامعتبر است.", mainMenu(ctx.actor));

    // A test *send* posts a visible message into the customer's channel, so it
    // is confirmed first; a test *check* is read-only and runs immediately.
    if (action === "ts") {
      return respond(
        bot, ctx,
        `📨 یک پیام تست در کانال ${platformLabel(platform)} این کلاینت ارسال می‌شود. ادامه می‌دهید؟`,
        confirmMenu(`a:cl:tsy:${args[0]}:${siteId}`, `a:cl:pf:${siteId}`),
      );
    }

    const result = await testClientPlatform(siteId, platform, { mode: action === "tsy" ? "send" : "check" });
    await auditBot(ctx.actor, "client.platform.test", {
      targetType: "site", targetId: siteId, success: result.ok,
      metadata: { platform, mode: action === "tsy" ? "send" : "check", error_code: result.error_code || null },
    });

    const body = result.ok
      ? `✅ اتصال ${platformLabel(platform)} سالم است.\n\n<code>${escapeHtml(JSON.stringify(result.details || {}).slice(0, 300))}</code>`
      : `❌ تست ${platformLabel(platform)} ناموفق بود.\nکد: <code>${escapeHtml(result.error_code || "unknown")}</code>\n${escapeHtml(String(result.error).slice(0, 300))}`;
    return respond(bot, ctx, body, platformMenu(ctx.actor, siteId));
  }

  if (action === "st") {
    if (!can(ctx.actor, PERMISSIONS.PLATFORMS_UPDATE)) return ctx.deny();
    const platform = PLATFORM_CODES[args[0]];
    const siteId = args.slice(1).join(":");
    if (!["telegram", "bale"].includes(platform)) {
      return respond(bot, ctx, "این پلتفرم هدف قابل ویرایش از ربات ندارد.", platformMenu(ctx.actor, siteId));
    }
    await startFlow(bot, ctx.chatId, ctx.actor, "client_target", {
      step: "value",
      data: { site_id: siteId, platform },
      prompt: `✏️ هدف جدید ${platformLabel(platform)} را بفرستید یا «ندارد» برای حذف:`,
    });
    return undefined;
  }

  if (action === "ed") {
    if (!can(ctx.actor, PERMISSIONS.CLIENTS_UPDATE)) return ctx.deny();
    const siteId = args.join(":");
    const keyboard = EDIT_FIELD_KEYS.map((field) => [{
      text: `✏️ ${editFieldLabel(field)}`,
      callback_data: `a:cl:edf:${field}:${siteId}`,
    }]);
    keyboard.push([backTo(`a:cl:v:${siteId}`, "⬅️ کلاینت")]);
    return respond(bot, ctx, "کدام مورد ویرایش شود؟", { reply_markup: { inline_keyboard: keyboard } });
  }

  if (action === "edf") {
    if (!can(ctx.actor, PERMISSIONS.CLIENTS_UPDATE)) return ctx.deny();
    const field = args[0];
    const siteId = args.slice(1).join(":");
    if (!EDIT_FIELD_KEYS.includes(field)) return respond(bot, ctx, "فیلد نامعتبر.", mainMenu(ctx.actor));
    await startFlow(bot, ctx.chatId, ctx.actor, "client_edit", {
      step: "value",
      data: { site_id: siteId, field },
      prompt: `✏️ ${editFieldPrompt(field)}`,
    });
    return undefined;
  }

  if (action === "off") {
    if (!can(ctx.actor, PERMISSIONS.CLIENTS_DISABLE)) return ctx.deny();
    const siteId = args.join(":");
    return respond(
      bot, ctx,
      "⛔ با غیرفعال شدن کلاینت، وبهوک وردپرس آن رد می‌شود و انتشاری انجام نخواهد شد. ادامه می‌دهید؟",
      confirmMenu(`a:cl:offy:${siteId}`, `a:cl:v:${siteId}`),
    );
  }

  if (action === "offy" || action === "on") {
    if (!can(ctx.actor, PERMISSIONS.CLIENTS_DISABLE)) return ctx.deny();
    const enable = action === "on";
    const siteId = args.join(":");
    await setClientEnabled(siteId, enable);
    await auditBot(ctx.actor, enable ? "client.enable" : "client.disable", { targetType: "site", targetId: siteId });
    const client = await getClientDetail(siteId);
    return respond(bot, ctx, `${enable ? "✅ کلاینت فعال شد." : "⛔ کلاینت غیرفعال شد."}\n\n${renderClientDetail(client)}`,
      clientMenu(ctx.actor, siteId, { enabled: client.enabled }));
  }

  if (action === "rot") {
    if (!can(ctx.actor, PERMISSIONS.CLIENTS_ROTATE_SECRET)) return ctx.deny();
    const siteId = args.join(":");
    return respond(
      bot, ctx,
      "🔑 رمز وبهوک تعویض می‌شود و پلاگین وردپرس مشتری تا وارد کردن رمز جدید کار نخواهد کرد. ادامه می‌دهید؟",
      confirmMenu(`a:cl:roty:${siteId}`, `a:cl:v:${siteId}`),
    );
  }

  if (action === "roty") {
    if (!can(ctx.actor, PERMISSIONS.CLIENTS_ROTATE_SECRET)) return ctx.deny();
    const siteId = args.join(":");
    const result = await rotateWebhookSecret(siteId);
    if (!result) return respond(bot, ctx, "کلاینت یافت نشد.", mainMenu(ctx.actor));
    await auditBot(ctx.actor, "client.rotate_secret", { targetType: "site", targetId: siteId });
    return respond(bot, ctx, [
      "🔑 <b>رمز وبهوک تعویض شد</b>",
      "",
      `Site ID: <code>${escapeHtml(siteId)}</code>`,
      `Webhook Secret: <code>${escapeHtml(result.webhook_secret)}</code>`,
      "",
      "<i>این مقدار فقط همین یک‌بار نمایش داده می‌شود.</i>",
    ].join("\n"), clientMenu(ctx.actor, siteId, { enabled: true }));
  }

  return respond(bot, ctx, "دستور ناشناخته.", mainMenu(ctx.actor));
});

/* ----------------------------- publications ----------------------------- */

route("pub", PERMISSIONS.PUBLICATIONS_VIEW, async (bot, ctx) => {
  const [action, ...args] = ctx.args;

  if (action === "l" || action === "f") {
    const page = Number(args[0]) || 1;
    const onlyFailed = action === "f";
    const result = await listPublications({
      page, page_size: PAGE_SIZE, ...(onlyFailed ? { status: "failed" } : {}),
    });

    const keyboard = result.items.map((publication) => [{
      text: `#${publication.id} ${publication.status === "failed" ? "❌" : "✅"} ${publication.platform} · ${publication.post_id}`.slice(0, 60),
      callback_data: `a:pub:v:${publication.id}`,
    }]);
    const navigation = pager(onlyFailed ? "pub:f" : "pub", page, result.pagination.has_next, result.pagination.has_previous);
    if (navigation.length) {
      keyboard.push(navigation.map((button) => ({
        ...button,
        callback_data: button.callback_data.replace("a:pub:f:l:", "a:pub:f:"),
      })));
    }
    keyboard.push([
      { text: onlyFailed ? "📢 همه" : "❌ فقط ناموفق", callback_data: onlyFailed ? "a:pub:l:1" : "a:pub:f:1" },
      backTo("a:menu", "🏠 منو"),
    ]);

    return respond(bot, ctx, renderPublicationList(result, {
      title: onlyFailed ? "❌ انتشارهای ناموفق" : "📢 انتشارها",
    }), { reply_markup: { inline_keyboard: keyboard } });
  }

  if (action === "v") {
    const publication = await getPublication(Number(args[0]));
    if (!publication) return respond(bot, ctx, "انتشار یافت نشد.", mainMenu(ctx.actor));

    const keyboard = [];
    if (publication.retry_eligible && can(ctx.actor, PERMISSIONS.PUBLICATIONS_RETRY)) {
      keyboard.push([{ text: "🔁 تلاش مجدد", callback_data: `a:pub:rt:${publication.id}` }]);
    }
    keyboard.push([backTo(`a:cl:v:${publication.site_id}`, "🌐 کلاینت"), backTo("a:pub:l:1", "⬅️ فهرست")]);
    return respond(bot, ctx, renderPublicationDetail(publication), { reply_markup: { inline_keyboard: keyboard } });
  }

  if (action === "rt") {
    if (!can(ctx.actor, PERMISSIONS.PUBLICATIONS_RETRY)) return ctx.deny();
    const id = Number(args[0]);
    const row = (await query("SELECT * FROM publications WHERE id=$1", [id])).rows[0];
    if (!row || !isRetryEligible(row)) {
      return respond(bot, ctx, "این انتشار قابل تلاش مجدد نیست.", mainMenu(ctx.actor));
    }

    const stored = (await query(
      `SELECT payload FROM publication_retries
        WHERE site_id=$1 AND post_id=$2 AND event_type=$3 AND platform=$4
        ORDER BY id DESC LIMIT 1`,
      [row.site_id, row.post_id, row.event_type, row.platform],
    )).rows[0];

    if (!stored?.payload) {
      return respond(bot, ctx,
        "⚠️ محتوای اصلی این انتشار ذخیره نشده است؛ رویداد را دوباره از وردپرس ارسال کنید.",
        { reply_markup: { inline_keyboard: [[backTo(`a:pub:v:${id}`, "⬅️ بازگشت")]] } });
    }

    const ad = stored.payload.enc
      ? JSON.parse(decryptText(stored.payload.enc, config.credentialKey))
      : stored.payload.plain;
    await enqueueRetry({
      ad, platform: row.platform, publicationId: row.id,
      requestedBy: `telegram:${ctx.actor.username}`, delayMs: 0,
    });
    await auditBot(ctx.actor, "publication.retry", {
      targetType: "publication", targetId: id, metadata: { platform: row.platform, site_id: row.site_id },
    });
    return respond(bot, ctx, "🔁 در صف تلاش مجدد قرار گرفت.", {
      reply_markup: { inline_keyboard: [[backTo(`a:pub:v:${id}`, "⬅️ جزئیات")]] },
    });
  }

  return respond(bot, ctx, "دستور ناشناخته.", mainMenu(ctx.actor));
});

/* -------------------------------- users -------------------------------- */

route("usr", PERMISSIONS.USERS_VIEW, async (bot, ctx) => {
  const [action, ...args] = ctx.args;

  if (action === "l") {
    const page = Number(args[0]) || 1;
    const result = await listUsers({ page, page_size: PAGE_SIZE });
    const keyboard = result.items.map((user) => [{
      text: `${user.display_name || user.username || `#${user.id}`}`.slice(0, 60),
      callback_data: `a:usr:v:${user.id}`,
    }]);
    const navigation = pager("usr", page, result.pagination.has_next, result.pagination.has_previous);
    if (navigation.length) keyboard.push(navigation);
    keyboard.push([{ text: "🔍 جست‌وجو", callback_data: "a:usr:search" }, backTo("a:menu", "🏠 منو")]);
    return respond(bot, ctx, renderUserList(result), { reply_markup: { inline_keyboard: keyboard } });
  }

  if (action === "search") {
    await startFlow(bot, ctx.chatId, ctx.actor, "user_search", {
      step: "term",
      prompt: "🔍 نام، نام کاربری یا Telegram ID را بفرستید:",
    });
    return undefined;
  }

  if (action === "v") {
    // The bot never receives a full phone number, whatever the admin's role.
    const user = await getUserDetail(Number(args[0]), { includePhone: false });
    if (!user) return respond(bot, ctx, "کاربر یافت نشد.", mainMenu(ctx.actor));

    const keyboard = [];
    if (can(ctx.actor, PERMISSIONS.USERS_UPDATE)) {
      keyboard.push([user.status === "suspended"
        ? { text: "✅ فعال‌سازی", callback_data: `a:usr:act:${user.id}` }
        : { text: "⛔ تعلیق", callback_data: `a:usr:sus:${user.id}` }]);
    }
    if (can(ctx.actor, PERMISSIONS.USERS_SESSIONS_REVOKE)) {
      keyboard.push([{ text: "🚪 ابطال نشست‌ها", callback_data: `a:usr:rev:${user.id}` }]);
    }
    keyboard.push([backTo("a:usr:l:1", "⬅️ فهرست"), backTo("a:menu", "🏠 منو")]);
    return respond(bot, ctx, renderUserDetail(user), { reply_markup: { inline_keyboard: keyboard } });
  }

  if (action === "sus") {
    if (!can(ctx.actor, PERMISSIONS.USERS_UPDATE)) return ctx.deny();
    return respond(bot, ctx, "⛔ با تعلیق کاربر، نشست‌های پنل او باطل می‌شود. ادامه می‌دهید؟",
      confirmMenu(`a:usr:susy:${args[0]}`, `a:usr:v:${args[0]}`));
  }

  if (action === "susy" || action === "act") {
    if (!can(ctx.actor, PERMISSIONS.USERS_UPDATE)) return ctx.deny();
    const id = Number(args[0]);
    const status = action === "act" ? "active" : "suspended";
    await setUserStatus(id, status);
    await auditBot(ctx.actor, status === "suspended" ? "user.suspend" : "user.activate", {
      targetType: "user", targetId: id,
    });
    const user = await getUserDetail(id, { includePhone: false });
    return respond(bot, ctx, `${status === "suspended" ? "⛔ کاربر تعلیق شد." : "✅ کاربر فعال شد."}\n\n${renderUserDetail(user)}`, {
      reply_markup: { inline_keyboard: [[backTo(`a:usr:v:${id}`, "⬅️ کاربر"), backTo("a:menu", "🏠 منو")]] },
    });
  }

  if (action === "rev") {
    if (!can(ctx.actor, PERMISSIONS.USERS_SESSIONS_REVOKE)) return ctx.deny();
    const id = Number(args[0]);
    const revoked = await revokeUserSessions(id);
    await auditBot(ctx.actor, "user.sessions.revoke", { targetType: "user", targetId: id, metadata: { revoked } });
    return respond(bot, ctx, `🚪 ${faNumber(revoked)} نشست باطل شد.`, {
      reply_markup: { inline_keyboard: [[backTo(`a:usr:v:${id}`, "⬅️ کاربر")]] },
    });
  }

  return respond(bot, ctx, "دستور ناشناخته.", mainMenu(ctx.actor));
});

/* ---------------------------- subscriptions ---------------------------- */

route("sub", PERMISSIONS.SUBSCRIPTIONS_VIEW, async (bot, ctx) => {
  const [action, ...args] = ctx.args;

  if (action === "l" || action === "s") {
    const state = action === "s" ? args[0] : "";
    const page = Number(action === "s" ? args[1] : args[0]) || 1;
    const result = await listSubscriptions({ page, page_size: PAGE_SIZE, state: state || undefined });

    const titles = { active: "💳 اشتراک‌های فعال", expiring: "⏳ رو به انقضا", expired: "⛔ منقضی‌شده" };
    const keyboard = [];
    if (can(ctx.actor, PERMISSIONS.SUBSCRIPTIONS_MANAGE)) {
      keyboard.push(...result.items.slice(0, 5).map((subscription) => [{
        text: `➕ تمدید #${subscription.id} · ${subscription.display_name || ""}`.slice(0, 60),
        callback_data: `a:sub:ext:${subscription.id}`,
      }]));
    }
    keyboard.push([
      { text: "فعال", callback_data: "a:sub:s:active:1" },
      { text: "رو به انقضا", callback_data: "a:sub:s:expiring:1" },
      { text: "منقضی", callback_data: "a:sub:s:expired:1" },
    ]);
    const navigation = state
      ? pager("sub:s", page, result.pagination.has_next, result.pagination.has_previous).map((button) => ({
        ...button,
        callback_data: button.callback_data.replace("a:sub:s:l:", `a:sub:s:${state}:`),
      }))
      : pager("sub", page, result.pagination.has_next, result.pagination.has_previous);
    if (navigation.length) keyboard.push(navigation);
    keyboard.push([backTo("a:menu", "🏠 منو")]);

    return respond(bot, ctx, renderSubscriptionList(result, titles[state] || "💳 اشتراک‌ها"), {
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  if (action === "ext") {
    if (!can(ctx.actor, PERMISSIONS.SUBSCRIPTIONS_MANAGE)) return ctx.deny();
    await startFlow(bot, ctx.chatId, ctx.actor, "subscription_extend", {
      step: "days",
      data: { subscription_id: Number(args[0]) },
      prompt: `➕ تعداد روز تمدید اشتراک #${escapeHtml(args[0])} را بفرستید (۱ تا ۳۶۵۰):`,
    });
    return undefined;
  }

  return respond(bot, ctx, "دستور ناشناخته.", mainMenu(ctx.actor));
});

/* -------------------------------- other -------------------------------- */

route("inv", PERMISSIONS.INVOICES_VIEW, async (bot, ctx) => {
  const page = Number(ctx.args[1]) || 1;
  const result = await listInvoices({ page, page_size: PAGE_SIZE });
  const keyboard = [];
  const navigation = pager("inv", page, result.pagination.has_next, result.pagination.has_previous);
  if (navigation.length) keyboard.push(navigation);
  keyboard.push([backTo("a:menu", "🏠 منو")]);
  await respond(bot, ctx, renderInvoiceList(result), { reply_markup: { inline_keyboard: keyboard } });
});

route("fld", PERMISSIONS.FIELDS_VIEW, async (bot, ctx) => {
  const result = await listClients({ page: 1, page_size: 10 });
  const keyboard = result.items.map((client) => [{
    text: `🧩 ${client.name || client.id}`.slice(0, 60),
    callback_data: `a:cl:fld:${client.id}`,
  }]);
  keyboard.push([backTo("a:menu", "🏠 منو")]);
  await respond(bot, ctx, "🧩 <b>فیلدهای انتشار</b>\n\nکلاینت را انتخاب کنید:", {
    reply_markup: { inline_keyboard: keyboard },
  });
});

route("pf", PERMISSIONS.PLATFORMS_VIEW, async (bot, ctx) => {
  const status = await platformHealth({ probe: true });
  await respond(bot, ctx, renderPlatformHealth(status), {
    reply_markup: { inline_keyboard: [[backTo("a:menu", "🏠 منو")]] },
  });
});

route("log", PERMISSIONS.AUDIT_VIEW, async (bot, ctx) => {
  const page = Number(ctx.args[0]) || 1;
  const result = await listAudit({ page, page_size: PAGE_SIZE });
  const keyboard = [];
  const navigation = pager("log", page, result.pagination.has_next, result.pagination.has_previous)
    .map((button) => ({ ...button, callback_data: button.callback_data.replace("a:log:l:", "a:log:") }));
  if (navigation.length) keyboard.push(navigation);
  keyboard.push([backTo("a:menu", "🏠 منو")]);
  await respond(bot, ctx, renderAuditList(result), { reply_markup: { inline_keyboard: keyboard } });
});

route("tools", PERMISSIONS.PUBLICATIONS_RETRY, async (bot, ctx) => {
  const [action] = ctx.args;

  if (action === "run") {
    const result = await runRetryWorker();
    await auditBot(ctx.actor, "publication.retry.run", { targetType: "retry_queue", targetId: "batch", metadata: result });
    return respond(bot, ctx, [
      "🧰 <b>اجرای صف تلاش مجدد</b>",
      "",
      `پردازش‌شده: ${faNumber(result.processed)}`,
      `موفق: ${faNumber(result.succeeded)} · ناموفق: ${faNumber(result.failed)}`,
    ].join("\n"), { reply_markup: { inline_keyboard: [[backTo("a:tools", "⬅️ ابزارها")]] } });
  }

  const retries = await listRetries({ page: 1, page_size: 5 });
  const lines = retries.items.length
    ? retries.items.map((job) => `${job.status === "pending" ? "⏳" : job.status === "failed" ? "❌" : "✅"} #${job.id} ${platformLabel(job.platform)} · ${escapeHtml(job.site_id)} · پست ${escapeHtml(job.post_id)} (${faNumber(job.attempts)}/${faNumber(job.max_attempts)})`).join("\n")
    : "صف خالی است.";

  await respond(bot, ctx, [
    "🧰 <b>ابزارها</b>",
    "",
    "<b>صف تلاش مجدد</b>",
    lines,
  ].join("\n"), {
    reply_markup: {
      inline_keyboard: [
        [{ text: "▶️ اجرای صف", callback_data: "a:tools:run" }],
        [backTo("a:menu", "🏠 منو")],
      ],
    },
  });
});


/* ------------------------------ tickets/content bot tools ------------------------------ */

route("tk", PERMISSIONS.TICKETS_VIEW, async (bot, ctx) => {
  const [action, ...args] = ctx.args;
  if (action === "sites") {
    const result = await listClients({ page: 1, page_size: 8 });
    const keyboard = result.items.map((client) => [{ text: `🎫 ${client.name || client.id}`, callback_data: `a:tk:l:${client.id}:1` }]);
    keyboard.push([backTo("a:menu", "🏠 منو")]);
    return respond(bot, ctx, "🎫 <b>تیکت‌های جارچی</b>\n\nیک سایت را انتخاب کنید:", { reply_markup: { inline_keyboard: keyboard } });
  }
  if (action === "l") {
    const siteId = args[0]; const page = Number(args[1]) || 1;
    const site = (await listClients({ q: siteId, page: 1, page_size: 5 })).items[0];
    if (!site) return respond(bot, ctx, "سایت پیدا نشد.", mainMenu(ctx.actor));
    const result = await listTickets(site, { page, per_page: 6 });
    const keyboard = (result.tickets || []).map((t) => [{ text: `#${t.number} · ${String(t.subject || "").slice(0, 48)}`, callback_data: `a:tk:v:${siteId}:${t.id}` }]);
    if (result.pagination?.pages > page) keyboard.push([{ text: "بعدی ▶️", callback_data: `a:tk:l:${siteId}:${page + 1}` }]);
    keyboard.push([backTo("a:tk:sites", "⬅️ سایت‌ها"), backTo("a:menu", "🏠 منو")]);
    const body = (result.tickets || []).map((t) => `${t.unread_for_support ? "🔴" : "🎫"} <b>#${t.number}</b> · ${escapeHtml(t.subject)}\n${escapeHtml(t.status)} · ${escapeHtml(t.priority || "normal")}`).join("\n\n") || "تیکتی یافت نشد.";
    return respond(bot, ctx, `🎫 <b>تیکت‌ها</b>\n\n${body}`, { reply_markup: { inline_keyboard: keyboard } });
  }
  if (action === "v") {
    const siteId = args[0]; const ticketId = args[1];
    const site = (await listClients({ q: siteId, page: 1, page_size: 5 })).items[0];
    if (!site) return respond(bot, ctx, "سایت پیدا نشد.", mainMenu(ctx.actor));
    const result = await getTicket(site, ticketId);
    const t = result.ticket;
    const body = [
      `🎫 <b>#${escapeHtml(t.number)}</b> · ${escapeHtml(t.subject)}`,
      `وضعیت: ${escapeHtml(t.status)} · اولویت: ${escapeHtml(t.priority || "normal")}`,
      `کاربر: ${escapeHtml(t.customer?.name || "—")} · ${escapeHtml(t.customer?.phone || "")}`,
      "",
      ...(t.messages || []).slice(-8).map((m) => `${m.sender === "admin" ? "🧑‍💼" : "👤"} <b>${escapeHtml(m.author || "")}</b>\n${escapeHtml(m.body || "")}`),
    ].join("\n");
    const keyboard = [];
    if (can(ctx.actor, PERMISSIONS.TICKETS_REPLY)) keyboard.push([{ text: "✍️ پاسخ", callback_data: `a:tk:r:${siteId}:${ticketId}` }]);
    if (can(ctx.actor, PERMISSIONS.TICKETS_MANAGE)) keyboard.push([{ text: "✅ بسته شود", callback_data: `a:tk:s:${siteId}:${ticketId}:closed` }, { text: "🔎 بررسی", callback_data: `a:tk:s:${siteId}:${ticketId}:reviewing` }]);
    keyboard.push([backTo(`a:tk:l:${siteId}:1`, "⬅️ تیکت‌ها")]);
    return respond(bot, ctx, body, { reply_markup: { inline_keyboard: keyboard } });
  }
  if (action === "r") {
    if (!can(ctx.actor, PERMISSIONS.TICKETS_REPLY)) return ctx.deny();
    const siteId = args[0]; const ticketId = args[1];
    const site = (await listClients({ q: siteId, page: 1, page_size: 5 })).items[0];
    await startFlow(bot, ctx.chatId, ctx.actor, "ticket_reply", { step: "message", prompt: `✍️ پاسخ تیکت #${ticketId} را بفرستید:`, data: { site, ticket_id: ticketId } });
    return undefined;
  }
  if (action === "s") {
    if (!can(ctx.actor, PERMISSIONS.TICKETS_MANAGE)) return ctx.deny();
    const siteId = args[0]; const ticketId = args[1]; const status = args[2];
    const site = (await listClients({ q: siteId, page: 1, page_size: 5 })).items[0];
    await setTicketStatus(site, ticketId, status);
    return respond(bot, ctx, "✅ وضعیت تیکت به‌روزرسانی شد.", { reply_markup: { inline_keyboard: [[backTo(`a:tk:v:${siteId}:${ticketId}`, "⬅️ تیکت")]] } });
  }
  return respond(bot, ctx, "بخش تیکت‌ها", { reply_markup: { inline_keyboard: [[backTo("a:tk:sites", "انتخاب سایت")]] } });
});

route("ct", PERMISSIONS.TICKETS_CREATE, async (bot, ctx) => {
  const [action, siteId] = ctx.args;
  if (action === "sites") {
    const result = await listClients({ page: 1, page_size: 8 });
    const keyboard = result.items.map((client) => [{ text: `🌐 ${client.name || client.id}`, callback_data: `a:ct:choose:${client.id}` }]);
    keyboard.push([backTo("a:menu", "🏠 منو")]);
    return respond(bot, ctx, "✍️ <b>ایجاد محتوا از ربات</b>\n\nسایت مقصد را انتخاب کنید:", { reply_markup: { inline_keyboard: keyboard } });
  }
  if (action === "choose") {
    const code = ctx.args[1];
    const keyboard = [[
      { text: "📢 اطلاعیه", callback_data: `a:ct:ann:${code}` },
      { text: "🛒 محصول", callback_data: `a:ct:prod:${code}` },
    ], [backTo("a:menu", "🏠 منو")]];
    return respond(bot, ctx, "نوع محتوا را انتخاب کنید:", { reply_markup: { inline_keyboard: keyboard } });
  }
  if (action === "ann") {
    const code = ctx.args[1];
    const site = (await listClients({ q: code, page: 1, page_size: 5 })).items[0];
    await startFlow(bot, ctx.chatId, ctx.actor, "announcement_create", { step: "title", prompt: "۱/۲ عنوان اطلاعیه را بفرستید:", data: { site } });
    return undefined;
  }
  if (action === "prod") {
    const code = ctx.args[1];
    const site = (await listClients({ q: code, page: 1, page_size: 5 })).items[0];
    await startFlow(bot, ctx.chatId, ctx.actor, "product_create", { step: "name", prompt: "۱/۴ نام محصول را بفرستید:", data: { site } });
    return undefined;
  }
  if (action === "product_commit") return commitProductCreate(bot, ctx.chatId, ctx.actor);
  return respond(bot, ctx, "بخش محتوا", mainMenu(ctx.actor));
});

route("set", PERMISSIONS.SETTINGS_VIEW, async (bot, ctx) => {
  await respond(bot, ctx, renderSettings(ctx.actor), {
    reply_markup: { inline_keyboard: [[backTo("a:menu", "🏠 منو")]] },
  });
});

route("flow", null, async (bot, ctx) => {
  if (ctx.args[0] === "cancel") {
    await clearState(ctx.actor.telegram_user_id, ctx.chatId);
    await respond(bot, ctx, "✖️ عملیات لغو شد.", mainMenu(ctx.actor));
    return;
  }
  if (ctx.args[0] === "product_commit") {
    if (!can(ctx.actor, PERMISSIONS.TICKETS_CREATE)) return ctx.deny();
    return commitProductCreate(bot, ctx.chatId, ctx.actor);
  }
});

/* ------------------------------ entrypoints ------------------------------ */

export async function handleAdminCommand(bot, msg) {
  const result = await authorize(msg, null, { action: "bot.admin_menu" });
  if (!result.ok) {
    await bot.sendMessage(msg.chat.id, result.message);
    return;
  }
  const user = await upsertIdentity("telegram", msg.from.id, {
    display_name: msg.from.first_name || result.actor.display_name || result.actor.username || "Admin",
    username: msg.from.username || "",
  });
  const token = await createSession(user.id, "telegram", 4);
  await bot.sendMessage(msg.chat.id, `${adminHeader(result.actor)}\n\nپنل مدیریت اکنون داخل Mini App باز می‌شود.`, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "🛠️ باز کردن پنل مدیریت", web_app: { url: `${config.publicBaseUrl}/app/?platform=telegram#session=${encodeURIComponent(token)}` } }]] },
  });
}

/** Cancels an in-flight flow from the /cancel command. */
export async function handleAdminCancel(bot, msg) {
  const result = await authorize(msg, null, { action: "bot.cancel" });
  if (!result.ok) return;
  await cancelFlow(bot, String(msg.chat.id), result.actor);
}

/**
 * Handles an admin callback. Returns true when the callback belonged to the
 * admin interface (so the caller stops looking for other handlers).
 */
export async function handleAdminCallback(bot, callbackQuery) {
  const data = String(callbackQuery.data || "");
  if (!data.startsWith("a:")) return false;

  // Administrative control is now intentionally centralized in the Mini App.
  // Keep legacy callback handling only as a compatibility bridge: old buttons
  // open the same signed Mini App instead of executing administrative actions.
  const authorization = await authorize(callbackQuery, null, { action: "bot.miniapp_redirect" });
  if (!authorization.ok) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: authorization.message, show_alert: true });
    return true;
  }
  const user = await upsertIdentity("telegram", callbackQuery.from.id, {
    display_name: [callbackQuery.from.first_name, callbackQuery.from.last_name].filter(Boolean).join(" "),
    username: callbackQuery.from.username || "",
  });
  const token = await createSession(user.id, "telegram", 4);
  await bot.answerCallbackQuery(callbackQuery.id, { text: "پنل مدیریت به Mini App منتقل شده است." });
  await bot.sendMessage(callbackQuery.message.chat.id, "🛠️ پنل مدیریت جارچی", {
    reply_markup: { inline_keyboard: [[{ text: "🛠️ باز کردن پنل مدیریت", web_app: { url: `${config.publicBaseUrl}/app/?platform=telegram#session=${encodeURIComponent(token)}` } }]] },
  });
  return true;

}

/** Feeds a plain message into an active flow, if the sender has one. */
export async function handleAdminMessage(bot, msg) {
  if (!msg.text) return false;
  const telegramUserId = String(msg.from?.id || "");
  if (!telegramUserId) return false;

  // Cheap check first: no state means this is not flow input, and we avoid an
  // admin lookup on every message the bot sees.
  const state = await getState(telegramUserId, String(msg.chat.id));
  if (!state) return false;

  const authorization = await authorize(msg, null, { action: "bot.flow_input" });
  if (!authorization.ok) {
    await clearState(telegramUserId, String(msg.chat.id));
    return false;
  }
  return handleFlowMessage(bot, msg, authorization.actor);
}

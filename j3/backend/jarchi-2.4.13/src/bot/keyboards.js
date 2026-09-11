import { can, PERMISSIONS } from "../core/rbac.js";

/**
 * Inline keyboards for the admin bot.
 *
 * Callback data is a short, structured token (`a:<section>:<action>:<arg>`);
 * it names an action only. Authorization is re-checked server-side on every
 * press — a crafted callback cannot grant anything.
 *
 * Menus are filtered by the pressing admin's permissions, so a viewer is not
 * shown buttons that would be refused.
 */

export const CALLBACK_PREFIX = "a:";

export function mainMenu(actor) {
  const rows = [];
  const add = (permission, button) => { if (!permission || can(actor, permission)) rows.push([button]); };
  const pair = (left, right) => {
    const buttons = [left, right].filter(Boolean);
    if (buttons.length) rows.push(buttons);
  };

  add(PERMISSIONS.DASHBOARD_VIEW, { text: "📊 داشبورد", callback_data: "a:dash" });
  pair(
    can(actor, PERMISSIONS.USERS_VIEW) ? { text: "👥 کاربران", callback_data: "a:usr:l:1" } : null,
    can(actor, PERMISSIONS.CLIENTS_VIEW) ? { text: "🌐 کلاینت‌ها", callback_data: "a:cl:l:1" } : null,
  );
  pair(
    can(actor, PERMISSIONS.PLATFORMS_VIEW) ? { text: "📡 پلتفرم‌ها", callback_data: "a:pf" } : null,
    can(actor, PERMISSIONS.PUBLICATIONS_VIEW) ? { text: "📢 انتشارها", callback_data: "a:pub:l:1" } : null,
  );
  pair(
    can(actor, PERMISSIONS.TICKETS_VIEW) ? { text: "🎫 تیکت‌ها", callback_data: "a:tk:sites" } : null,
    can(actor, PERMISSIONS.TICKETS_CREATE) ? { text: "✍️ محتوا از ربات", callback_data: "a:ct:sites" } : null,
  );
  pair(
    can(actor, PERMISSIONS.SUBSCRIPTIONS_VIEW) ? { text: "💳 اشتراک‌ها", callback_data: "a:sub:l:1" } : null,
    can(actor, PERMISSIONS.INVOICES_VIEW) ? { text: "🧾 پرداخت‌ها", callback_data: "a:inv:l:1" } : null,
  );
  pair(
    can(actor, PERMISSIONS.FIELDS_VIEW) ? { text: "🧩 فیلدها", callback_data: "a:fld" } : null,
    can(actor, PERMISSIONS.AUDIT_VIEW) ? { text: "📋 گزارش‌ها", callback_data: "a:log:1" } : null,
  );
  pair(
    can(actor, PERMISSIONS.PUBLICATIONS_RETRY) ? { text: "🧰 ابزارها", callback_data: "a:tools" } : null,
    can(actor, PERMISSIONS.SETTINGS_VIEW) ? { text: "⚙️ تنظیمات", callback_data: "a:set" } : null,
  );

  return { reply_markup: { inline_keyboard: rows } };
}

export const backTo = (target, label = "⬅️ بازگشت") => ({ text: label, callback_data: target });

export function pager(section, page, hasNext, hasPrevious, extra = "") {
  const suffix = extra ? `:${extra}` : "";
  const buttons = [];
  if (hasPrevious) buttons.push({ text: "◀️ قبلی", callback_data: `a:${section}:l:${page - 1}${suffix}` });
  if (hasNext) buttons.push({ text: "بعدی ▶️", callback_data: `a:${section}:l:${page + 1}${suffix}` });
  return buttons;
}

export function clientMenu(actor, siteId, { enabled = true } = {}) {
  const rows = [];
  if (can(actor, PERMISSIONS.PUBLICATIONS_VIEW)) {
    rows.push([{ text: "📢 انتشارها", callback_data: `a:cl:pub:${siteId}` }]);
  }
  if (can(actor, PERMISSIONS.TICKETS_VIEW)) {
    rows.push([{ text: "🎫 تیکت‌های این سایت", callback_data: `a:tk:l:${siteId}:1` }]);
  }
  if (can(actor, PERMISSIONS.FIELDS_VIEW)) {
    rows.push([{ text: "🧩 فیلدهای انتشار", callback_data: `a:cl:fld:${siteId}` }]);
  }
  if (can(actor, PERMISSIONS.WEBHOOKS_VIEW)) {
    rows.push([{ text: "🔗 وبهوک و تشخیص", callback_data: `a:cl:wh:${siteId}` }]);
  }
  if (can(actor, PERMISSIONS.PLATFORMS_VIEW)) {
    rows.push([{ text: "📡 پلتفرم‌ها", callback_data: `a:cl:pf:${siteId}` }]);
  }
  if (can(actor, PERMISSIONS.CLIENTS_UPDATE)) {
    rows.push([{ text: "✏️ ویرایش", callback_data: `a:cl:ed:${siteId}` }]);
  }
  if (can(actor, PERMISSIONS.CLIENTS_DISABLE)) {
    rows.push([{
      text: enabled ? "⛔ غیرفعال‌سازی" : "✅ فعال‌سازی",
      callback_data: `a:cl:${enabled ? "off" : "on"}:${siteId}`,
    }]);
  }
  if (can(actor, PERMISSIONS.CLIENTS_ROTATE_SECRET)) {
    rows.push([{ text: "🔑 تعویض رمز وبهوک", callback_data: `a:cl:rot:${siteId}` }]);
  }
  rows.push([backTo("a:cl:l:1", "⬅️ فهرست کلاینت‌ها"), backTo("a:menu", "🏠 منو")]);
  return { reply_markup: { inline_keyboard: rows } };
}

export function platformMenu(actor, siteId) {
  const rows = [];
  const testable = can(actor, PERMISSIONS.PLATFORMS_TEST);
  for (const [platform, code, label] of [["telegram", "t", "تلگرام"], ["bale", "b", "بله"], ["whatsapp", "w", "واتس‌اپ"]]) {
    const row = [];
    if (testable) {
      row.push({ text: `🔍 تست ${label}`, callback_data: `a:cl:tc:${code}:${siteId}` });
      if (platform !== "whatsapp") {
        row.push({ text: `📨 ارسال تست`, callback_data: `a:cl:ts:${code}:${siteId}` });
      }
    }
    if (row.length) rows.push(row);
  }
  if (can(actor, PERMISSIONS.PLATFORMS_UPDATE)) {
    rows.push([
      { text: "✏️ هدف تلگرام", callback_data: `a:cl:st:t:${siteId}` },
      { text: "✏️ هدف بله", callback_data: `a:cl:st:b:${siteId}` },
    ]);
  }
  rows.push([backTo(`a:cl:v:${siteId}`, "⬅️ کلاینت"), backTo("a:menu", "🏠 منو")]);
  return { reply_markup: { inline_keyboard: rows } };
}

/** Two-step confirmation for anything destructive or customer-visible. */
export function confirmMenu(confirmCallback, cancelCallback = "a:menu") {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ تایید", callback_data: confirmCallback },
        { text: "✖️ انصراف", callback_data: cancelCallback },
      ]],
    },
  };
}

export const cancelFlowMenu = () => ({
  reply_markup: { inline_keyboard: [[{ text: "✖️ لغو", callback_data: "a:flow:cancel" }]] },
});

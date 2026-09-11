import { escapeHtml, truncateText } from "./utils.js";
import { orderFieldVisible } from "../core/orderFields.js";

const MAX_MESSAGE = 4096;
const MAX_ITEMS = 15;

/** Persian labels for the WooCommerce statuses, so the message is not English. */
const STATUS_LABELS = Object.freeze({
  pending: "در انتظار پرداخت",
  processing: "در حال انجام",
  "on-hold": "در انتظار بررسی",
  completed: "تکمیل‌شده",
  cancelled: "لغوشده",
  refunded: "بازپرداخت‌شده",
  failed: "ناموفق",
  trash: "حذف‌شده",
  draft: "پیش‌نویس",
  "checkout-draft": "پیش‌نویس",
});

/** A leading emoji per status, so the state is legible before the text is read. */
const STATUS_ICONS = Object.freeze({
  pending: "🕓",
  processing: "⚙️",
  "on-hold": "⏸",
  completed: "✅",
  cancelled: "🚫",
  refunded: "↩️",
  failed: "⚠️",
});

/**
 * A human label for a WooCommerce status.
 *
 * An unknown status is shown as itself rather than as "unknown": a shop with a
 * custom status has a real state, and hiding its name helps nobody.
 *
 * @param {string} status Raw status.
 * @returns {string} Label.
 */
export function statusLabel(status) {
  const key = String(status || "").replace(/^wc-/, "").toLowerCase();

  return STATUS_LABELS[key] || key || "نامشخص";
}

/** @param {string} status Raw status. @returns {string} Emoji, or "". */
export function statusIcon(status) {
  return STATUS_ICONS[String(status || "").replace(/^wc-/, "").toLowerCase()] || "•";
}

/**
 * Formats money the way a Persian shop reads it.
 *
 * Returns "" for null, which is how a missing figure stays missing: printing
 * "0 تومان" for a shop that simply did not send a shipping line is an
 * invention, and an operator cannot tell an invention from a fact.
 *
 * @param {number|null} amount   Amount.
 * @param {string} currency      Currency code.
 * @returns {string} Formatted amount, or "".
 */
export function formatMoney(amount, currency = "") {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return "";

  const value = Number(amount);
  // Rials and Tomans are not written with decimals; other currencies are.
  const whole = ["IRR", "IRT", "TOMAN", ""].includes(String(currency || "").toUpperCase());
  const text = new Intl.NumberFormat("fa-IR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);

  const suffix = { IRT: "تومان", TOMAN: "تومان", IRR: "ریال" }[String(currency || "").toUpperCase()] || currency;

  return suffix ? `${text} ${suffix}` : text;
}

/** Renders a date in the Persian calendar, which is what the reader uses. */
function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tehran",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

/**
 * Builds the Telegram notification for one order.
 *
 * Every line is gated on the site's own field policy. A field switched off does
 * not appear — not blank, not "—", absent — because an order notification
 * carries a customer's name, telephone number and address, and a site that
 * switched the telephone off has said something the message has to honour.
 *
 * @param {object} order    Normalised order.
 * @param {object} options
 * @param {Record<string, boolean>|null} options.fields  Site's saved partial field map.
 * @param {string} options.title  Heading, so a status change can say so.
 * @returns {{text: string}} Telegram HTML.
 */
export function formatOrderNotification(order, { fields = null, title = "" } = {}) {
  const show = (key) => orderFieldVisible(fields, key);
  const lines = [];

  const heading = title || "🛒 <b>سفارش جدید ووکامرس</b>";
  lines.push(heading, "");

  const number = order.order_number || String(order.order_id || "");
  if (number) lines.push(`🧾 <b>سفارش:</b> #${escapeHtml(number)}`);

  if (show("order_status") && order.status) {
    lines.push(`${statusIcon(order.status)} <b>وضعیت:</b> ${escapeHtml(statusLabel(order.status))}`);
  }

  if (show("customer_name") && order.customer_name) {
    lines.push(`👤 <b>مشتری:</b> ${escapeHtml(order.customer_name)}`);
  }

  if (show("customer_phone") && order.customer_phone) {
    lines.push(`📞 <b>تلفن:</b> ${escapeHtml(order.customer_phone)}`);
  }

  if (show("customer_email") && order.customer_email) {
    lines.push(`✉️ <b>ایمیل:</b> ${escapeHtml(order.customer_email)}`);
  }

  if (show("payment_method") && order.payment_method) {
    lines.push(`💳 <b>پرداخت:</b> ${escapeHtml(order.payment_method)}`);
  }

  if (show("payment_status") && order.payment_status) {
    lines.push(`💠 <b>وضعیت پرداخت:</b> ${escapeHtml(order.payment_status)}`);
  }

  if (show("created_at") && order.created_at) {
    const date = formatDate(order.created_at);
    if (date) lines.push(`🗓 <b>تاریخ:</b> ${escapeHtml(date)}`);
  }

  /* --- Money. Each line only when it has a figure behind it. --- */

  const money = [];
  if (show("subtotal") && order.subtotal !== null) money.push(`جمع اقلام: ${formatMoney(order.subtotal, order.currency)}`);
  if (show("discount") && order.discount) money.push(`تخفیف: ${formatMoney(order.discount, order.currency)}`);
  if (show("shipping") && order.shipping_total !== null) money.push(`ارسال: ${formatMoney(order.shipping_total, order.currency)}`);

  if (money.length) {
    lines.push("", ...money.map((line) => `▫️ ${escapeHtml(line)}`));
  }

  if (show("total") && order.total !== null) {
    lines.push(`💰 <b>مبلغ کل:</b> ${escapeHtml(formatMoney(order.total, order.currency))}`);
  }

  /* --- Items. --- */

  if (show("products") && Array.isArray(order.items) && order.items.length) {
    lines.push("", "🛍 <b>کالاها:</b>");

    for (const item of order.items.slice(0, MAX_ITEMS)) {
      const quantity = show("quantity") && item.quantity > 0 ? ` × ${item.quantity}` : "";
      lines.push(`• ${escapeHtml(item.name)}${escapeHtml(quantity)}`);
    }

    // A fifty-line order would push everything else past Telegram's limit, so
    // the tail is counted rather than printed.
    if (order.items.length > MAX_ITEMS) {
      lines.push(`… و ${order.items.length - MAX_ITEMS} قلم دیگر`);
    }
  }

  /* --- Addresses, which are off unless the site asked for them. --- */

  if (show("billing_address") && order.billing_address) {
    lines.push("", `🏠 <b>آدرس صورتحساب:</b> ${escapeHtml(order.billing_address)}`);
  }

  if (show("shipping_address") && order.shipping_address) {
    lines.push(`🚚 <b>آدرس ارسال:</b> ${escapeHtml(order.shipping_address)}`);
  }

  if (show("order_link") && order.admin_url) {
    lines.push("", `🔗 ${escapeHtml(order.admin_url)}`);
  }

  return { text: truncateText(lines.join("\n").trim(), MAX_MESSAGE) };
}

/** The heading for a status-change notification, which is not a new order. */
export function statusChangeTitle(order) {
  return `🔄 <b>تغییر وضعیت سفارش</b> — ${escapeHtml(statusLabel(order.status))}`;
}

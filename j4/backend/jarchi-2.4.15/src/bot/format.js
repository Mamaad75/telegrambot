/** Shared Persian formatting helpers for bot messages. */

export const faNumber = (value) => Number(value || 0).toLocaleString("fa-IR");

export function faDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("fa-IR", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return "—";
  }
}

export function faDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("fa-IR", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export const statusIcon = (status) => ({
  published: "✅",
  failed: "❌",
  skipped: "⏭",
  deleted: "🗑",
  superseded: "♻️",
  blocked: "⛔",
  unsupported: "🚫",
  pending: "⏳",
  processing: "⚙️",
  succeeded: "✅",
  cancelled: "🚫",
  active: "✅",
  expired: "⛔",
  disabled: "⛔",
  suspended: "⛔",
}[String(status)] || "•");

export const platformLabel = (platform) => ({
  telegram: "تلگرام",
  bale: "بله",
  whatsapp: "واتس‌اپ",
}[String(platform)] || String(platform));

export const roleLabel = (role) => ({
  super_admin: "مدیر ارشد",
  admin: "مدیر",
  support: "پشتیبانی",
  viewer: "بازدیدکننده",
}[String(role)] || String(role));

/** Trims a value so a bot message never breaks Telegram's 4096-char limit. */
export function clamp(text, maxLength = 3800) {
  const value = String(text ?? "");
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

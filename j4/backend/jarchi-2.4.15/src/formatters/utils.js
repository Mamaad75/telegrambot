const ALLOWED_HTML = new Set(["b", "strong", "i", "em", "u", "s", "code", "pre", "a", "br"]);

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function sanitizeTelegramHtml(value = "") {
  let text = String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, "");

  text = text.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (full, tag, attrs) => {
    const lower = String(tag).toLowerCase();
    if (!ALLOWED_HTML.has(lower)) return "";
    if (lower === "a") {
      const match = String(attrs).match(/href\s*=\s*["']([^"']+)["']/i);
      const href = match?.[1] || "";
      if (!/^https?:\/\//i.test(href) && !/^tg:\/\//i.test(href)) return "";
      return `<a href="${escapeHtml(href)}">`;
    }
    if (lower === "br") return "<br>";
    return full.replace(/\s+[a-z:-]+\s*=\s*["'][^"']*["']/gi, "");
  });

  return text;
}

export function visibleLength(value = "") {
  const stripped = String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#039);/g, "x");
  return Array.from(stripped).length;
}

export function truncateText(value, maxLength) {
  const raw = String(value ?? "");
  const chars = Array.from(raw);
  if (chars.length <= maxLength) return raw;
  if (maxLength <= 1) return "…";
  const cut = chars.slice(0, maxLength - 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function normalizeWhitespace(value = "") {
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderTextValue(value, meta = {}) {
  const normalized = normalizeWhitespace(value);
  if (meta.type === "url") {
    const safe = escapeHtml(normalized);
    return `<a href="${safe}">${safe}</a>`;
  }
  return escapeHtml(normalized);
}

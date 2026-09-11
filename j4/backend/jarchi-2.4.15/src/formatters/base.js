import { getFieldsForPlatform, getMetaForPlatform } from "../core/fieldPolicy.js";
import { renderTextValue, sanitizeTelegramHtml, truncateText, normalizeWhitespace } from "./utils.js";

const DEFAULT_LABELS = Object.freeze({
  title: "عنوان",
  description: "توضیحات",
  phone: "شماره تماس",
  category: "دسته‌بندی",
});

const EXCLUDED_TEXT_KEYS = new Set(["title", "description", "permalink", "url"]);

const DEFAULT_RENDERING = Object.freeze({
  mode: "structured",
  title: { enabled: true, icon: "", bold: true },
  fields: { enabled: true, showLabels: true, bullet: "", separator: ": ", compact: false },
  category: { enabled: true, label: "دسته‌بندی", icon: "" },
  description: { enabled: true, label: "", icon: "", heading: false },
  divider: { enabled: true, character: "─", length: 28 },
  footer: { enabled: false, text: "" },
});

function mergeDeep(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra && typeof extra === "object" ? extra : {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      out[key] = mergeDeep(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function cleanToken(value, fallback = "") {
  const raw = value == null ? fallback : value;
  return String(raw ?? "").trim();
}

function cleanSeparator(value, fallback = ": ") {
  const raw = value == null ? fallback : String(value);
  return raw.length ? raw : fallback;
}

function displayValue(item, html) {
  const meta = item.meta || {};
  const raw = item.value;
  return html ? renderTextValue(raw, meta) : raw;
}

function renderMultiline(value, html, compact = false) {
  const raw = normalizeWhitespace(value);
  if (!raw) return "";
  const rendered = html ? renderTextValue(raw) : raw;
  if (compact) return rendered.replace(/\n+/g, "، ");
  return rendered;
}

function normalizeRendering(rendering = {}) {
  return mergeDeep(DEFAULT_RENDERING, rendering);
}

export function buildFormatContext(ad, platform, selectedKeys = null) {
  return {
    platform,
    fields: getFieldsForPlatform(ad, platform, selectedKeys),
    fieldMeta: getMetaForPlatform(ad, platform, selectedKeys),
    buttons: ad?.buttons || {},
    title: ad?.title || ad?.fields?.title || "",
    description: ad?.description || ad?.fields?.description || "",
    permalink: ad?.url || ad?.permalink || ad?.fields?.permalink || "",
    images: Array.isArray(ad?.images) ? ad.images : [],
    taxonomy: ad?.taxonomy || {},
    author: ad?.author || {},
    rendering: normalizeRendering(ad?.rendering || {}),
  };
}

export function orderedRenderableFields(context) {
  return Object.entries(context.fields)
    .filter(([key]) => !EXCLUDED_TEXT_KEYS.has(key))
    .map(([key, value]) => {
      const meta = context.fieldMeta[key] || {};
      const valueString = Array.isArray(value) ? value.filter(Boolean).join(String(meta.separator ?? "، ")) : String(value ?? "").trim();
      const nestedMeta = meta.meta && typeof meta.meta === "object" ? meta.meta : {};
      return {
        key,
        value: valueString,
        meta,
        label: cleanToken(meta.label || DEFAULT_LABELS[key] || key, key),
        order: Number(meta.order ?? 9999),
        icon: cleanToken(meta.icon || nestedMeta.icon || ""),
        prefix: cleanToken(meta.prefix || nestedMeta.prefix || ""),
        suffix: cleanToken(meta.suffix || nestedMeta.suffix || ""),
      };
    })
    .filter((item) => item.value)
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

function categoryName(context) {
  return String(
    context.taxonomy?.category?.name ||
      context.taxonomy?.term?.name ||
      context.taxonomy?.categories?.[0]?.name ||
      "",
  ).trim();
}

function hasCategoryField(fields) {
  return fields.some((item) => /categor/i.test(item.key) || /دسته/.test(item.label));
}

function dividerText(settings, html) {
  if (!settings?.enabled) return "";
  const char = cleanToken(settings.character, "—").slice(0, 3) || "—";
  const length = Math.max(6, Math.min(80, Number(settings.length) || 28));
  const text = char.repeat(length);
  return html ? sanitizeTelegramHtml(text) : text;
}

function renderField(item, settings, html) {
  const value = displayValue(item, html);
  const label = html ? `<b>${sanitizeTelegramHtml(item.label)}</b>` : item.label;
  const icon = item.icon ? `${html ? sanitizeTelegramHtml(item.icon) : item.icon} ` : "";
  const bullet = cleanToken(settings.bullet);
  const prefix = item.prefix ? `${html ? sanitizeTelegramHtml(item.prefix) : item.prefix}` : "";
  const suffix = item.suffix ? `${html ? sanitizeTelegramHtml(item.suffix) : item.suffix}` : "";
  const separator = cleanSeparator(settings.separator, ": ");

  let line;
  if (settings.showLabels === false) {
    line = `${icon}${prefix}${value}${suffix}`;
  } else {
    line = `${icon}${prefix}${label}${separator}${value}${suffix}`;
  }

  return bullet ? `${bullet} ${line}` : line;
}

export function buildAutomaticText(context, { html = false, maxLength = 4096 } = {}) {
  const cfg = normalizeRendering(context.rendering);
  const lines = [];
  const title = String(context.title || "").trim();
  const description = String(context.description || "").trim();
  const fields = orderedRenderableFields(context);

  if (cfg.title?.enabled !== false && title) {
    const titleValue = html && cfg.title.bold
      ? `<b>${sanitizeTelegramHtml(title)}</b>`
      : (html ? sanitizeTelegramHtml(title) : title);
    lines.push(`${cleanToken(cfg.title.icon)}${cfg.title.icon ? " " : ""}${titleValue}`);
  }

  if (cfg.fields?.enabled !== false) {
    for (const item of fields) {
      // Description is rendered as a paragraph below, not once as a field and
      // once again as the description block. URL is intentionally a button.
      if (item.key === "category" && cfg.category?.enabled === false) continue;
      lines.push(renderField(item, cfg.fields || {}, html));
    }
  }

  const category = categoryName(context);
  if (cfg.category?.enabled !== false && category && !hasCategoryField(fields)) {
    const icon = cleanToken(cfg.category.icon);
    const label = cleanToken(cfg.category.label, DEFAULT_LABELS.category);
    lines.push(`${icon ? `${icon} ` : ""}${html ? `<b>${sanitizeTelegramHtml(label)}:</b>` : `${label}:`} ${html ? sanitizeTelegramHtml(category) : category}`);
  }

  if (cfg.description?.enabled !== false && description) {
    const body = renderMultiline(description, html, Boolean(cfg.fields?.compact));
    if (cfg.description.heading === true || cfg.description.label) {
      const icon = cleanToken(cfg.description.icon);
      const label = cleanToken(cfg.description.label, DEFAULT_LABELS.description);
      lines.push(`${icon ? `${icon} ` : ""}${html ? `<b>${sanitizeTelegramHtml(label)}:</b>` : `${label}:`}`);
      lines.push(body);
    } else {
      lines.push(body);
    }
  }

  const divider = dividerText(cfg.divider, html);
  if (divider) lines.push(divider);

  const footer = cleanToken(cfg.footer?.text);
  if (cfg.footer?.enabled && footer) lines.push(html ? sanitizeTelegramHtml(footer) : footer);

  return truncateText(lines.filter((line, index) => line !== "" || index === 0).join("\n"), maxLength);
}

export function sanitizeCustomMessage(message, maxLength = 4096) {
  return truncateText(sanitizeTelegramHtml(String(message || "")), maxLength);
}

export function shouldUseCustomMessage(ad) {
  return String(ad?.rendering?.mode || "structured").toLowerCase() === "custom";
}

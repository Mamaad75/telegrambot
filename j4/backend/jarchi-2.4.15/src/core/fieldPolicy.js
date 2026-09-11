const SYSTEM_KEYS = new Set([
  "id",
  "post_id",
  "site_id",
  "event_id",
  "post_type",
  "slug",
  "published_at",
  "updated_at",
  "featured_image",
  "images",
  "media",
  "excerpt",
  "raw",
]);

function hasExplicitPlatformVisibility(meta) {
  return Boolean(meta && meta.platforms && typeof meta.platforms === "object");
}

function isVisibleForPlatform(meta = {}, platform) {
  if (hasExplicitPlatformVisibility(meta)) return meta.platforms?.[platform] === true;
  const visibility = String(meta.visibility || "").toLowerCase();
  if (!visibility || ["hidden", "backend", "admin"].includes(visibility)) return false;
  if (visibility === "all" || visibility === "public") return true;
  return visibility === platform;
}

export function getFieldsForPlatform(ad, platform, selectedKeys = null) {
  const fields = ad?.fields && typeof ad.fields === "object" ? ad.fields : {};
  const meta = ad?.field_meta && typeof ad.field_meta === "object" ? ad.field_meta : {};
  const selected = Array.isArray(selectedKeys) && selectedKeys.length ? new Set(selectedKeys) : null;
  const result = {};

  for (const [key, value] of Object.entries(fields)) {
    if (SYSTEM_KEYS.has(key)) continue;
    if (value === null || value === undefined || String(value).trim() === "") continue;
    if (selected && !selected.has(key)) continue;

    const definition = meta[key] || {};
    if (!isVisibleForPlatform(definition, platform)) continue;

    result[key] = value;
  }

  return result;
}

export function getMetaForPlatform(ad, platform, selectedKeys = null) {
  const meta = ad?.field_meta && typeof ad.field_meta === "object" ? ad.field_meta : {};
  const selected = Array.isArray(selectedKeys) && selectedKeys.length ? new Set(selectedKeys) : null;
  const result = {};

  for (const [key, definition] of Object.entries(meta)) {
    if (selected && !selected.has(key)) continue;
    if (SYSTEM_KEYS.has(key)) continue;
    if (!isVisibleForPlatform(definition || {}, platform)) continue;
    result[key] = definition || {};
  }

  return result;
}

export function isFieldVisible(ad, platform, key) {
  const meta = ad?.field_meta?.[key] || {};
  return isVisibleForPlatform(meta, platform);
}

export function isSystemField(key) {
  return SYSTEM_KEYS.has(key);
}

/**
 * The advertiser contact phone, if field policy allows it on this platform.
 *
 * This is the single rule used by the publication engine *and* the formatters,
 * so a formatter can never render a contact button for a platform the policy
 * hides the number from.
 *
 * Precedence: an explicit `field_meta.phone.platforms` map wins; otherwise the
 * legacy `visibility` value decides; a payload with no phone metadata at all
 * keeps the pre-1.3 behaviour of allowing it.
 */
export function resolveContactPhone(ad, platform) {
  const meta = ad?.field_meta?.phone || {};
  const platforms = meta.platforms;

  if (platforms && typeof platforms === "object") {
    if (platforms[platform] !== true) return "";
  } else {
    const visibility = String(meta.visibility || "").toLowerCase();
    if (visibility && ![platform, "all", "public"].includes(visibility)) return "";
  }

  return String(ad?.author?.phone || ad?.fields?.phone || "").trim();
}

/**
 * Folds an operator's field overrides into an ad's `field_meta`.
 *
 * WordPress decides what a field is; an operator decides where it goes. Rather
 * than teach every formatter about a second source, the override is merged into
 * the metadata once, before any policy runs, so the existing rules above stay
 * the only place visibility is decided.
 *
 * Returns the ad unchanged when the site has no overrides, which is the common
 * case and keeps the hot publication path free of copying.
 */
export function applyFieldOverrides(ad, overrides) {
  if (!overrides || !Object.keys(overrides).length) return ad;

  const meta = ad?.field_meta && typeof ad.field_meta === "object" ? ad.field_meta : {};
  const merged = { ...meta };

  for (const [key, override] of Object.entries(overrides)) {
    const base = merged[key] && typeof merged[key] === "object" ? { ...merged[key] } : {};

    if (override.hidden) {
      // An explicit map beats the `visibility` string, so hiding has to be
      // expressed as a map or a stale visibility value would still let the
      // field through.
      base.platforms = { telegram: false, bale: false, whatsapp: false };
    } else if (override.platforms && typeof override.platforms === "object") {
      const existing = base.platforms && typeof base.platforms === "object" ? base.platforms : null;
      const resolved = { ...(existing || {}) };
      for (const [platform, allowed] of Object.entries(override.platforms)) {
        if (typeof allowed === "boolean") resolved[platform] = allowed;
      }
      // With no plugin map to build on, an override for one platform must not
      // silently grant the others: fill the rest in from the visibility string.
      if (!existing) {
        const visibility = String(base.visibility || "").toLowerCase();
        for (const platform of ["telegram", "bale", "whatsapp"]) {
          if (typeof resolved[platform] !== "boolean") {
            resolved[platform] = visibility === "all" || visibility === "public" || visibility === platform;
          }
        }
      }
      base.platforms = resolved;
    }

    if (override.label) base.label = override.label;
    if (Number.isFinite(Number(override.order))) base.order = Number(override.order);

    merged[key] = base;
  }

  return { ...ad, field_meta: merged };
}

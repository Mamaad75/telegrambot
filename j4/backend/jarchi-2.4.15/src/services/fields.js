import { query } from "../db/db.js";
import { buildFieldCatalogQuery } from "./fieldCatalogSql.js";

/**
 * Field catalog.
 *
 * WordPress is the source of truth for labels, order and type: the backend only
 * stores what `field_meta` says and shows it back. Nothing here invents a label
 * or re-discovers fields on its own.
 */

/**
 * Upserts a whole `field_meta` map in one statement.
 *
 * 1.2.0 issued one INSERT per field inside the webhook request, so a 25-field
 * post cost 25 round trips before the publication even started.
 */
export async function upsertFieldCatalog(siteId, fieldMeta = {}) {
  const entries = Object.entries(fieldMeta || {}).filter(([key]) => String(key || "").trim());
  if (!entries.length) return 0;

  const keys = [];
  const labels = [];
  const orders = [];
  const types = [];
  const visibilities = [];
  const metas = [];

  for (const [key, meta] of entries) {
    const definition = meta && typeof meta === "object" ? meta : {};
    keys.push(String(key).slice(0, 190));
    labels.push(String(definition.label ?? key).slice(0, 255));
    orders.push(Number.isFinite(Number(definition.order)) ? Number(definition.order) : 9999);
    types.push(definition.type ? String(definition.type).slice(0, 64) : null);
    visibilities.push(definition.visibility ? String(definition.visibility).slice(0, 64) : null);
    metas.push(JSON.stringify(definition));
  }

  const result = await query(
    `INSERT INTO site_field_catalog(site_id,field_key,label,field_order,field_type,visibility,field_meta)
     SELECT $1, k, l, o, t, v, m::jsonb
       FROM unnest($2::text[],$3::text[],$4::int[],$5::text[],$6::text[],$7::text[]) AS f(k,l,o,t,v,m)
     ON CONFLICT(site_id,field_key) DO UPDATE SET
       label=EXCLUDED.label,
       field_order=EXCLUDED.field_order,
       field_type=EXCLUDED.field_type,
       visibility=EXCLUDED.visibility,
       field_meta=EXCLUDED.field_meta,
       updated_at=NOW()`,
    [siteId, keys, labels, orders, types, visibilities, metas],
  );
  return result.rowCount;
}

/**
 * Field catalog for one site.
 *
 * Each row carries three layers, kept separate on purpose:
 *   - what the plugin last sent (`label`, `field_order`, `platforms`)
 *   - what an operator overrode (`*_override`, `hidden`)
 *   - the resulting effective values the UI and the publication engine use
 *
 * Keeping the plugin's own values visible is what lets a screen show "the
 * plugin calls this X, you renamed it to Y" and offer to drop the override.
 */
export async function listFieldCatalog(siteId) {
  // Build the projection from the columns that actually exist. Older Jarchi
  // installations can have migration-history rows without every baseline
  // column because CREATE TABLE IF NOT EXISTS cannot retrofit an existing table.
  // Never let optional timestamp/override drift turn the Fields screen into 500.
  let columns = await getFieldCatalogColumns();
  try {
    return (await query(buildFieldCatalogQuery(columns), [siteId])).rows.map(shapeField);
  } catch (error) {
    // A migration may have completed after the cached schema snapshot. Refresh
    // once and retry with the current physical table shape.
    fieldCatalogColumns = null;
    columns = await getFieldCatalogColumns();
    try {
      return (await query(buildFieldCatalogQuery(columns), [siteId])).rows.map(shapeField);
    } catch (retryError) {
      retryError.cause = error;
      throw retryError;
    }
  }
}


let fieldCatalogColumns = null;
async function getFieldCatalogColumns() {
  if (fieldCatalogColumns) return fieldCatalogColumns;
  const result = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='site_field_catalog'`,
  );
  fieldCatalogColumns = new Set(result.rows.map((row) => String(row.column_name)));
  return fieldCatalogColumns;
}

function shapeField(row) {
  // Surface the platform visibility map the plugin sent, so the admin screen
  // can render it without re-deriving policy.
  const platforms = row.field_meta?.platforms && typeof row.field_meta.platforms === "object"
    ? row.field_meta.platforms
    : null;
  const overrides = row.platform_overrides && typeof row.platform_overrides === "object"
    ? row.platform_overrides
    : null;

  return {
    ...row,
    platforms,
    effective_label: row.label_override || row.label || row.field_key,
    effective_order: row.order_override ?? row.field_order,
    effective_platforms: effectivePlatforms(platforms, overrides, row.visibility, row.hidden),
    has_override: Boolean(
      row.label_override || row.order_override !== null || overrides || row.hidden,
    ),
  };
}

/**
 * The platform visibility actually in force.
 *
 * `hidden` is absolute — an operator hiding a field means it goes nowhere. Below
 * that, an override for a platform wins over the plugin's map, and a platform
 * nobody has an opinion about falls back to the plugin's `visibility` string.
 */
function effectivePlatforms(pluginPlatforms, overrides, visibility, hidden) {
  const result = {};
  for (const platform of PLATFORMS) {
    if (hidden) { result[platform] = false; continue; }
    if (overrides && typeof overrides[platform] === "boolean") { result[platform] = overrides[platform]; continue; }
    if (pluginPlatforms) { result[platform] = pluginPlatforms[platform] === true; continue; }
    const value = String(visibility || "").toLowerCase();
    result[platform] = value === "all" || value === "public" || value === platform;
  }
  return result;
}

export const PLATFORMS = Object.freeze(["telegram", "bale", "whatsapp"]);

/**
 * Records an operator's override for one field.
 *
 * Only the keys present in `patch` are touched, so a screen that edits a label
 * cannot accidentally clear a platform choice made elsewhere. Passing an
 * explicit null clears that override and hands the field back to the plugin.
 */
export async function setFieldOverride(siteId, fieldKey, patch = {}, { actor = "" } = {}) {
  const updates = [];
  const params = [String(siteId), String(fieldKey)];
  const push = (sql, value) => { params.push(value); updates.push(sql.replace("?", `$${params.length}`)); };

  if (patch.label_override !== undefined) {
    const label = patch.label_override === null ? null : String(patch.label_override).trim().slice(0, 255);
    push("label_override=?", label || null);
  }
  if (patch.order_override !== undefined) {
    const order = patch.order_override === null ? null : Math.trunc(Number(patch.order_override));
    if (order !== null && (!Number.isFinite(order) || order < 0 || order > 99999)) {
      throw new Error("order_override must be between 0 and 99999");
    }
    push("order_override=?", order);
  }
  if (patch.platform_overrides !== undefined) {
    if (patch.platform_overrides === null) {
      push("platform_overrides=?::jsonb", null);
    } else {
      // UI toggles arrive as partial maps (for example {telegram:false}). Merge
      // atomically in PostgreSQL so changing one platform never erases choices
      // previously made for Bale/WhatsApp, including under concurrent edits.
      const map = sanitizePlatformMap(patch.platform_overrides);
      push("platform_overrides=NULLIF(COALESCE(platform_overrides,'{}'::jsonb) || ?::jsonb, '{}'::jsonb)", JSON.stringify(map));
    }
  }
  if (patch.hidden !== undefined) push("hidden=?", Boolean(patch.hidden));
  if (!updates.length) return null;

  push("overridden_by=?", String(actor || "").slice(0, 120));
  updates.push("overridden_at=NOW()");

  const row = (await query(
    `UPDATE site_field_catalog SET ${updates.join(",")}
      WHERE site_id=$1 AND field_key=$2
      RETURNING field_key,label,field_order,field_type,visibility,field_meta,
                label_override,order_override,platform_overrides,hidden,
                overridden_at,overridden_by,
                created_at AS first_seen_at, updated_at AS last_seen_at`,
    params,
  )).rows[0];
  return row ? shapeField(row) : null;
}

/** Only the platforms we publish to, and only booleans, ever reach the column. */
function sanitizePlatformMap(input) {
  const map = {};
  for (const platform of PLATFORMS) {
    if (typeof input?.[platform] === "boolean") map[platform] = input[platform];
  }
  return map;
}

/**
 * Applies an explicit field order.
 *
 * The whole list is rewritten in one statement so the result cannot end up
 * half-ordered if two operators drag rows at the same time; keys that are not
 * part of this site's catalog are ignored rather than inserted.
 */
export async function reorderFields(siteId, orderedKeys = [], { actor = "" } = {}) {
  const keys = [...new Set((orderedKeys || []).map((key) => String(key || "").trim()).filter(Boolean))];
  if (!keys.length) return 0;

  const result = await query(
    `UPDATE site_field_catalog c
        SET order_override = o.position, overridden_at = NOW(), overridden_by = $3
       FROM unnest($2::text[]) WITH ORDINALITY AS o(field_key, position)
      WHERE c.site_id = $1 AND c.field_key = o.field_key`,
    [String(siteId), keys, String(actor || "").slice(0, 120)],
  );
  return result.rowCount;
}

/**
 * The override map for one site, keyed by field, for the publication engine.
 *
 * Returns null when the site has no overrides at all, so the common case costs
 * nothing beyond the lookup and the engine can skip merging entirely.
 */
export async function getFieldOverrides(siteId) {
  const rows = (await query(
    `SELECT field_key,label_override,order_override,platform_overrides,hidden
       FROM site_field_catalog
      WHERE site_id=$1
        AND (label_override IS NOT NULL OR order_override IS NOT NULL
             OR platform_overrides IS NOT NULL OR hidden = TRUE)`,
    [siteId],
  )).rows;
  if (!rows.length) return null;

  const map = {};
  for (const row of rows) {
    map[row.field_key] = {
      label: row.label_override || null,
      order: row.order_override,
      platforms: row.platform_overrides || null,
      hidden: row.hidden === true,
    };
  }
  return map;
}

export async function countFields(siteId) {
  return (await query(
    "SELECT COUNT(*)::int AS count FROM site_field_catalog WHERE site_id=$1",
    [siteId],
  )).rows[0].count;
}

/** Build the field-catalog projection from the columns that physically exist. */
export function buildFieldCatalogQuery(columns) {
  const optional = (name, fallback) => columns.has(name) ? name : `${fallback} AS ${name}`;
  const effectiveOrder = columns.has("order_override") ? "order_override" : "NULL::integer";
  const firstSeen = columns.has("created_at") ? "created_at" : "NULL::timestamptz";
  const lastSeen = columns.has("updated_at") ? "updated_at" : (columns.has("created_at") ? "created_at" : "NULL::timestamptz");
  return `SELECT field_key,label,field_order,field_type,visibility,field_meta,
            ${optional("label_override", "NULL::text")},
            ${optional("order_override", "NULL::integer")},
            ${optional("platform_overrides", "NULL::jsonb")},
            ${optional("hidden", "FALSE")},
            ${optional("overridden_at", "NULL::timestamptz")},
            ${optional("overridden_by", "NULL::text")},
            ${firstSeen} AS first_seen_at, ${lastSeen} AS last_seen_at
       FROM site_field_catalog
      WHERE site_id=$1
      ORDER BY COALESCE(${effectiveOrder}, field_order) ASC, field_key ASC`;
}

const val = (v) => {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(val).filter(Boolean).join("، ");
  if (typeof v === "object") return val(v.value ?? v.rendered ?? v.label ?? v.name ?? v.title ?? "");
  return String(v).trim();
};

export function normalizeAd(p = {}) {
  const fields = p.fields && typeof p.fields === "object" ? p.fields : {};
  const field_meta = p.field_meta && typeof p.field_meta === "object" ? p.field_meta : {};
  const publication_targets = p.publication_targets && typeof p.publication_targets === "object" ? p.publication_targets : null;
  const buttons = p.buttons && typeof p.buttons === "object" ? p.buttons : {};
  const authorPhone = val(p.author?.phone || p.author?.mobile || p.phone || fields.phone || "");

  return {
    contract_version: String(p.contract_version || "1.0"),
    event_id: String(p.event_id || ""),
    event_type: String(p.event_type || p.event || "created").toLowerCase(),
    site_id: String(p.site_id || ""),
    post_id: String(p.post_id ?? p.id ?? ""),
    title: val(p.title || fields.title || p.post?.title || "بدون عنوان"),
    description: val(p.description || fields.description || p.post?.excerpt || ""),
    url: String(p.url || p.permalink || fields.url || fields.permalink || p.post?.link || ""),
    fields,
    field_meta,
    images: Array.isArray(p.images) ? p.images.filter(Boolean) : Array.isArray(p.media?.images) ? p.media.images.filter(Boolean) : p.featured_image?.url ? [p.featured_image.url] : [],
    taxonomy: p.taxonomy || {},
    author: {
      id: p.author?.id ?? null,
      name: val(p.author?.name || ""),
      username: val(p.author?.username || ""),
      phone: authorPhone,
    },
    buttons,
    publication_targets,
    message: val(p.message || ""),
    rendering: p.rendering && typeof p.rendering === "object" ? p.rendering : {},
    raw: p,
  };
}

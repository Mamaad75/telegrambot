function normalizeBase(url = "") {
  return String(url || "").replace(/\/+$/, "");
}
function authHeaders(site) {
  const secret = String(site?.webhook_secret || "").trim();
  if (!secret) throw new Error("WordPress site webhook secret is not configured");
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-API-Key": secret,
    "X-Jarchi-Secret": secret,
    "X-Webhook-Secret": secret,
    "X-Site-ID": String(site.id),
  };
}
async function request(site, path, body) {
  const base = normalizeBase(site?.wordpress_url);
  if (!/^https?:\/\//i.test(base)) throw new Error("Invalid WordPress URL");
  const response = await fetch(`${base}/wp-json/wp-event-publisher/v1${path}`, {
    method: "POST",
    headers: authHeaders(site),
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || data?.success === false) throw new Error(data?.message || data?.error || `WordPress content API failed (${response.status})`);
  return data;
}
export async function createAnnouncement(site, payload) {
  return request(site, "/bot/announcement", payload);
}
export async function createProduct(site, payload) {
  return request(site, "/bot/product", payload);
}
export async function getCapabilities(site) {
  const base = normalizeBase(site?.wordpress_url);
  const secret = String(site?.webhook_secret || "").trim();
  if (!secret) throw new Error("WordPress site webhook secret is not configured");
  const response = await fetch(`${base}/wp-json/wp-event-publisher/v1/bot/capabilities`, {
    headers: { Accept: "application/json", "X-API-Key": secret, "X-Jarchi-Secret": secret, "X-Webhook-Secret": secret, "X-Site-ID": String(site.id) },
  });
  const data = await response.json();
  if (!response.ok || data?.success === false) throw new Error(data?.message || data?.error || `Capabilities request failed (${response.status})`);
  return data;
}

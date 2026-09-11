import { safeEqual } from "../utils/security.js";

const cache = new Map();
const inflight = new Map();
const CACHE_TTL_MS = Number(process.env.TICKET_API_CACHE_MS || 2500);

function cached(key) {
  const hit = cache.get(key);
  if (!hit || hit.expires <= Date.now()) { if (hit) cache.delete(key); return null; }
  return hit.value;
}
function storeCache(key, value) {
  if (cache.size > 1000) { const first = cache.keys().next().value; if (first) cache.delete(first); }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}
function invalidateSite(siteId) {
  const prefix = `${String(siteId)}:`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
  for (const key of inflight.keys()) if (key.startsWith(prefix)) inflight.delete(key);
}
async function cachedRequest(key, producer) {
  const hit = cached(key);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const promise = Promise.resolve().then(producer).then((value) => storeCache(key, value)).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function normalizeBase(url = "") {
  return String(url || "").replace(/\/+$/, "");
}

function authHeaders(site) {
  const secret = String(site?.webhook_secret || "").trim();
  if (!secret) throw new Error("WordPress site webhook secret is not configured");
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Jarchi-Secret": secret,
    "X-Webhook-Secret": secret,
    "X-Site-ID": String(site.id),
  };
}

async function request(site, path, { method = "GET", body, signal } = {}) {
  const base = normalizeBase(site?.wordpress_url);
  if (!/^https?:\/\//i.test(base)) throw new Error("Invalid WordPress URL");
  const url = `${base}/wp-json/jarchi/v1${path}`;
  const controller = signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), Number(process.env.WP_TICKET_HTTP_TIMEOUT_MS || 12000)) : null;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: authHeaders(site),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal || controller?.signal,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || data?.success === false) {
    const message = data?.error?.message || data?.message || data?.error || `WordPress ticket API failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export async function listTickets(site, query = {}) {
  const q = new URLSearchParams();
  for (const key of ["page", "per_page", "status", "search", "agent", "department", "category", "priority"]) {
    if (query[key] !== undefined && query[key] !== "") q.set(key, String(query[key]));
  }
  q.set("scope", "customer");
  if (query.customer_email) q.set("customer_email", String(query.customer_email));
  const cacheKey = `${site.id}:list:${q.toString()}`;
  const hit = cached(cacheKey);
  if (hit) return hit;
  return cachedRequest(cacheKey, () => request(site, `/tickets?${q}`));
}

export async function getTicket(site, ticketId, scope = {}) {
  const q = new URLSearchParams({ scope: "customer" });
  if (scope.customer_email) q.set("customer_email", String(scope.customer_email));
  const cacheKey = `${site.id}:ticket:${ticketId}:${q.toString()}`;
  const hit = cached(cacheKey);
  if (hit) return hit;
  return cachedRequest(cacheKey, () => request(site, `/tickets/${encodeURIComponent(ticketId)}?${q}`));
}

export async function createTicket(site, body) {
  const result = await request(site, "/tickets", { method: "POST", body });
  invalidateSite(site.id);
  return result;
}

export async function replyTicket(site, ticketId, body) {
  const result = await request(site, `/tickets/${encodeURIComponent(ticketId)}/reply`, { method: "POST", body: { ...body, scope: "customer", customer_email: body.customer_email || "" } });
  invalidateSite(site.id);
  return result;
}

export async function setTicketStatus(site, ticketId, status, extra = {}) {
  const result = await request(site, `/tickets/${encodeURIComponent(ticketId)}/status`, { method: "POST", body: { status, scope: extra.scope || "customer", customer_email: extra.customer_email || "" } });
  invalidateSite(site.id);
  return result;
}

export async function assignTicket(site, ticketId, userId) {
  return request(site, `/tickets/${encodeURIComponent(ticketId)}/assign`, { method: "POST", body: { user_id: userId } });
}

export async function rateTicket(site, ticketId, body) {
  const result = await request(site, `/tickets/${encodeURIComponent(ticketId)}/rating`, { method: "POST", body });
  invalidateSite(site.id);
  return result;
}

export async function listAgents(site) {
  return request(site, "/agents");
}

export async function updateAgent(site, userId, action) {
  return request(site, "/agents", { method: "POST", body: { user_id: userId, action } });
}

export async function listCustomers(site, query = {}) {
  const q = new URLSearchParams();
  if (query.search) q.set("search", String(query.search));
  if (query.limit) q.set("limit", String(query.limit));
  return request(site, `/customers${q.toString() ? `?${q}` : ""}`);
}

export async function markTicketRead(site, ticketId, scope = {}) {
  const result = await request(site, `/tickets/${encodeURIComponent(ticketId)}/mark-read`, { method: "POST", body: { scope: "customer", customer_email: scope.customer_email || "" } });
  invalidateSite(site.id);
  return result;
}

export async function getUnread(site, scope = {}) {
  const q = new URLSearchParams({ scope: "customer" });
  if (scope.customer_email) q.set("customer_email", String(scope.customer_email));
  const cacheKey = `${site.id}:unread:${q.toString()}`;
  const hit = cached(cacheKey);
  if (hit) return hit;
  return cachedRequest(cacheKey, () => request(site, `/tickets/unread?${q}`));
}

export async function listTicketMeta(site) {
  return request(site, "/meta");
}

export async function listCannedReplies(site) {
  return request(site, "/canned-replies");
}

export async function listTicketStatusCounts(site, scope = {}) {
  const q = new URLSearchParams({ per_page: "1", scope: "customer" });
  if (scope.customer_email) q.set("customer_email", String(scope.customer_email));
  return request(site, `/tickets?${q}`);
}

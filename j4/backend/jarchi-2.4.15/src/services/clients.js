import { query, tx } from "../db/db.js";
import { randomSecret, encryptText, maskSecret } from "../utils/security.js";
import { ensureTrial } from "./billing.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { Filters, parsePagination, paginated } from "../utils/pagination.js";
import { countFields } from "./fields.js";

/**
 * Clients (a.k.a. sites) are first-class entities: one WordPress installation,
 * its webhook credentials, its platform targets and its publication history.
 * Both the web admin and the Telegram admin bot go through this module.
 */

const CLIENT_COLUMNS = `s.id,s.name,s.wordpress_url,s.owner_user_id,s.owner_telegram_id,s.enabled,
  s.telegram_channel_id,s.bale_chat_id,s.last_webhook_at,s.last_publication_at,s.last_failure_at,
  s.last_failure_message,s.webhook_event_count,s.webhook_failure_count,s.publication_success_count,
  s.publication_failure_count,s.notes,s.secret_rotated_at,s.created_at,s.updated_at`;

export function normalizeTelegramTarget(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("@")) return raw;
  const match = raw.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/([A-Za-z0-9_]+)\/?$/i);
  return match ? `@${match[1]}` : raw;
}

export async function syncEnvSites(sites) {
  for (const site of Object.values(sites)) {
    await query(
      `INSERT INTO sites(id,name,wordpress_url,webhook_secret,telegram_channel_id,bale_chat_id,owner_telegram_id)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET
         name=EXCLUDED.name,wordpress_url=EXCLUDED.wordpress_url,
         webhook_secret=EXCLUDED.webhook_secret,telegram_channel_id=EXCLUDED.telegram_channel_id,
         bale_chat_id=EXCLUDED.bale_chat_id,owner_telegram_id=EXCLUDED.owner_telegram_id,updated_at=NOW()`,
      [site.id, site.name, site.wordpress_url, site.webhook_secret,
        normalizeTelegramTarget(site.telegram_channel_id), site.bale_chat_id, site.owner_telegram_id],
    );
  }
}

/** Hot path: called on every WordPress webhook, so it stays a single lookup. */
export async function getSite(siteId) {
  return (await query(
    `SELECT id,name,wordpress_url,webhook_secret,owner_user_id,enabled,
            telegram_channel_id,bale_chat_id,owner_telegram_id
       FROM sites WHERE id=$1`,
    [siteId],
  )).rows[0] || null;
}

export function webhookUrl() {
  return `${config.publicBaseUrl || ""}/webhook`;
}

async function resolveOwnerUserId(ownerTelegramId, fallbackName) {
  const telegramId = String(ownerTelegramId || "").trim();
  if (!telegramId) return null;

  const existing = (await query(
    "SELECT user_id FROM identities WHERE platform='telegram' AND platform_user_id=$1",
    [telegramId],
  )).rows[0];
  if (existing) return Number(existing.user_id);

  const user = (await query(
    "INSERT INTO users(display_name,username,status) VALUES($1,$2,'active') RETURNING id",
    [String(fallbackName || "Jarchi client"), "client"],
  )).rows[0];
  await query(
    "INSERT INTO identities(user_id,platform,platform_user_id,username) VALUES($1,'telegram',$2,'')",
    [user.id, telegramId],
  );
  return Number(user.id);
}

export async function provisionClient(data) {
  if (!data.name || !data.wordpress_url) throw new Error("name and wordpress_url are required");

  const slug = String(data.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 24) || "client";

  let id = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `site_${slug}_${Math.random().toString(36).slice(2, 8)}`;
    if (!(await query("SELECT 1 FROM sites WHERE id=$1", [candidate])).rowCount) { id = candidate; break; }
  }
  if (!id) throw new Error("Could not generate unique site_id");

  const secret = randomSecret("jch");
  const ownerUserId = await resolveOwnerUserId(data.owner_telegram_id, data.name);
  if (ownerUserId && config.autoTrialOnStart) await ensureTrial(ownerUserId);

  const row = (await query(
    `INSERT INTO sites(id,name,wordpress_url,webhook_secret,owner_user_id,telegram_channel_id,bale_chat_id,owner_telegram_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id,name,wordpress_url,owner_user_id,telegram_channel_id,bale_chat_id,owner_telegram_id,enabled,created_at`,
    [id, data.name, data.wordpress_url, secret, ownerUserId,
      normalizeTelegramTarget(data.telegram_channel_id), data.bale_chat_id || "", data.owner_telegram_id || ""],
  )).rows[0];

  const trial = ownerUserId
    ? await query(
      `SELECT id,plan_id,starts_at,expires_at,status FROM subscriptions
        WHERE user_id=$1 AND plan_id='trial_7d' ORDER BY id DESC LIMIT 1`,
      [ownerUserId],
    )
    : { rows: [] };

  logger.info("client provisioned", {
    site_id: id,
    owner_user_id: ownerUserId,
    wordpress_url: data.wordpress_url,
    telegram_enabled: Boolean(data.telegram_channel_id),
    bale_enabled: Boolean(data.bale_chat_id),
    trial_expires_at: trial.rows[0]?.expires_at || null,
  });

  return {
    ...row,
    webhook_secret: secret,
    webhook_url: webhookUrl(),
    trial: trial.rows[0] || null,
  };
}

/* ------------------------------------------------------------------ *
 * Admin listing and detail
 * ------------------------------------------------------------------ */

export async function listClients(input = {}) {
  const { page, pageSize, limit, offset } = parsePagination(input);
  const filters = new Filters();

  if (input.enabled === "true" || input.enabled === true) filters.addRaw("s.enabled = true");
  if (input.enabled === "false" || input.enabled === false) filters.addRaw("s.enabled = false");
  filters.add("s.owner_user_id = ?", input.owner_user_id ? Number(input.owner_user_id) : undefined);
  filters.add("s.owner_telegram_id = ?", input.owner_telegram_id);

  if (input.q) {
    const term = filters.next(`%${String(input.q).trim()}%`);
    filters.addRaw(`(s.id ILIKE ${term} OR s.name ILIKE ${term} OR s.wordpress_url ILIKE ${term})`);
  }
  if (input.platform === "telegram") filters.addRaw("s.telegram_channel_id <> ''");
  if (input.platform === "bale") filters.addRaw("s.bale_chat_id <> ''");

  const where = filters.where();
  const sortable = {
    created_at: "s.created_at",
    name: "s.name",
    last_publication_at: "s.last_publication_at",
    last_webhook_at: "s.last_webhook_at",
  };
  const sort = sortable[String(input.sort || "created_at")] || "s.created_at";
  const direction = String(input.direction || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

  /*
   * Subscription status is joined in one pass instead of per-row lookups:
   * the previous admin list had no subscription data at all, and adding it
   * naively would have been an N+1 across every client.
   */
  const rows = (await query(
    `SELECT ${CLIENT_COLUMNS},
            u.display_name AS owner_name,
            u.username     AS owner_username,
            sub.status     AS subscription_status,
            sub.plan_id    AS subscription_plan,
            sub.expires_at AS subscription_expires_at
       FROM sites s
       LEFT JOIN users u ON u.id = s.owner_user_id
       LEFT JOIN LATERAL (
            SELECT status, plan_id, expires_at FROM subscriptions
             WHERE user_id = s.owner_user_id ORDER BY expires_at DESC LIMIT 1
       ) sub ON true
       ${where}
      ORDER BY ${sort} ${direction} NULLS LAST, s.id ASC
      LIMIT ${limit} OFFSET ${offset}`,
    filters.params,
  )).rows;

  const total = (await query(`SELECT COUNT(*)::int AS count FROM sites s ${where}`, filters.params)).rows[0].count;
  return paginated(rows.map(decorate), total, { page, pageSize });
}

function decorate(row) {
  return {
    ...row,
    platforms: {
      telegram: { configured: Boolean(row.telegram_channel_id), target: row.telegram_channel_id || "" },
      bale: { configured: Boolean(row.bale_chat_id), target: row.bale_chat_id || "" },
    },
    connection_status: connectionStatus(row),
  };
}

/**
 * A coarse health signal derived from what the site has actually done, so the
 * list view can show status without probing any platform API.
 */
function connectionStatus(row) {
  if (!row.enabled) return "disabled";
  if (!row.last_webhook_at) return "never_connected";
  if (row.last_failure_at && (!row.last_publication_at || new Date(row.last_failure_at) > new Date(row.last_publication_at))) {
    return "failing";
  }
  return "healthy";
}

/**
 * Full client detail. `includeSecret` is gated by the clients.secret_view
 * permission at the route/bot layer; otherwise a masked value is returned.
 */
export async function getClientDetail(siteId, { includeSecret = false } = {}) {
  const row = (await query(
    `SELECT ${CLIENT_COLUMNS}, s.webhook_secret,
            u.display_name AS owner_name, u.username AS owner_username, u.status AS owner_status
       FROM sites s LEFT JOIN users u ON u.id = s.owner_user_id
      WHERE s.id=$1`,
    [siteId],
  )).rows[0];
  if (!row) return null;

  const [subscription, publicationStats, platformStats, fieldCount, lastWebhook] = await Promise.all([
    query(
      `SELECT s.id,s.plan_id,s.status,s.starts_at,s.expires_at,p.name AS plan_name
         FROM subscriptions s JOIN plans p ON p.id=s.plan_id
        WHERE s.user_id=$1 ORDER BY s.expires_at DESC LIMIT 1`,
      [row.owner_user_id],
    ),
    query(
      `SELECT
         COUNT(*) FILTER (WHERE status='published')::int AS published,
         COUNT(*) FILTER (WHERE status='failed')::int    AS failed,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7_days
       FROM publications WHERE site_id=$1`,
      [siteId],
    ),
    query(
      `SELECT platform,
              COUNT(*) FILTER (WHERE status='published')::int AS published,
              COUNT(*) FILTER (WHERE status='failed')::int AS failed,
              MAX(published_at) AS last_published_at
         FROM publications WHERE site_id=$1 GROUP BY platform`,
      [siteId],
    ),
    countFields(siteId),
    query(
      `SELECT event_type,post_id,http_status,auth_result,duration_ms,error,created_at,request_id
         FROM site_webhook_events WHERE site_id=$1 ORDER BY id DESC LIMIT 1`,
      [siteId],
    ),
  ]);

  const { webhook_secret: secret, ...rest } = row;
  return {
    ...decorate(rest),
    webhook_url: webhookUrl(),
    webhook_secret: includeSecret ? secret : undefined,
    webhook_secret_masked: maskSecret(secret),
    subscription: subscription.rows[0] || null,
    publication_stats: publicationStats.rows[0],
    platform_stats: platformStats.rows,
    field_count: fieldCount,
    last_webhook_event: lastWebhook.rows[0] || null,
  };
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

const UPDATABLE = new Map([
  ["name", (value) => String(value).trim().slice(0, 190)],
  ["wordpress_url", (value) => String(value).trim()],
  ["telegram_channel_id", (value) => normalizeTelegramTarget(value)],
  ["bale_chat_id", (value) => String(value ?? "").trim()],
  ["notes", (value) => String(value ?? "").slice(0, 2000)],
  ["enabled", (value) => Boolean(value)],
]);

export async function updateClient(siteId, patch = {}) {
  const updates = [];
  const params = [];

  for (const [field, normalize] of UPDATABLE) {
    if (patch[field] === undefined) continue;
    params.push(normalize(patch[field]));
    updates.push(`${field}=$${params.length}`);
  }

  if (patch.owner_telegram_id !== undefined) {
    const telegramId = String(patch.owner_telegram_id || "").trim();
    const ownerUserId = telegramId
      ? await resolveOwnerUserId(telegramId, patch.name || siteId)
      : null;
    params.push(telegramId);
    updates.push(`owner_telegram_id=$${params.length}`);
    params.push(ownerUserId);
    updates.push(`owner_user_id=$${params.length}`);
    if (ownerUserId && config.autoTrialOnStart) await ensureTrial(ownerUserId);
  }

  if (!updates.length) return getClientDetail(siteId);

  params.push(siteId);
  const result = await query(
    `UPDATE sites SET ${updates.join(",")},updated_at=NOW() WHERE id=$${params.length} RETURNING id`,
    params,
  );
  if (!result.rowCount) return null;
  return getClientDetail(siteId);
}

export async function setClientEnabled(siteId, enabled) {
  const result = await query(
    "UPDATE sites SET enabled=$2,updated_at=NOW() WHERE id=$1 RETURNING id,enabled",
    [siteId, Boolean(enabled)],
  );
  return result.rows[0] || null;
}

/**
 * Issues a new webhook secret. The old one stops working immediately, so the
 * caller must hand the new value to the customer — the plaintext is returned
 * exactly once here and never stored anywhere else in cleartext.
 */
export async function rotateWebhookSecret(siteId) {
  const secret = randomSecret("jch");
  const result = await query(
    "UPDATE sites SET webhook_secret=$2,secret_rotated_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING id",
    [siteId, secret],
  );
  if (!result.rowCount) return null;
  logger.warn("webhook secret rotated", { site_id: siteId });
  return { id: siteId, webhook_secret: secret, webhook_url: webhookUrl() };
}

/** Records webhook arrival + result in one round trip. */
export async function recordWebhookEvent(event) {
  const failed = Number(event.http_status) >= 400;
  await query(
    `WITH inserted AS (
       INSERT INTO site_webhook_events(
         site_id,request_id,event_type,post_id,http_status,auth_result,
         duration_ms,contract_version,targets,error,ip)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
       RETURNING site_id
     )
     UPDATE sites SET
       last_webhook_at=NOW(),
       webhook_event_count=webhook_event_count+1,
       webhook_failure_count=webhook_failure_count + CASE WHEN $12 THEN 1 ELSE 0 END
     WHERE id=$1`,
    [
      String(event.site_id || ""),
      String(event.request_id || ""),
      String(event.event_type || ""),
      String(event.post_id || ""),
      Number(event.http_status) || 0,
      String(event.auth_result || ""),
      Number(event.duration_ms) || 0,
      String(event.contract_version || ""),
      JSON.stringify(event.targets || []),
      event.error ? String(event.error).slice(0, 500) : null,
      String(event.ip || "").slice(0, 64),
      failed,
    ],
  );
}

export async function listWebhookEvents(siteId, input = {}) {
  const { page, pageSize, limit, offset } = parsePagination(input);
  const filters = new Filters();
  filters.add("site_id = ?", siteId)
    .add("event_type = ?", input.event_type)
    .add("post_id = ?", input.post_id);
  const where = filters.where();

  const rows = (await query(
    `SELECT id,site_id,request_id,event_type,post_id,http_status,auth_result,duration_ms,
            contract_version,targets,error,created_at
       FROM site_webhook_events ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
    filters.params,
  )).rows;
  const total = (await query(
    `SELECT COUNT(*)::int AS count FROM site_webhook_events ${where}`,
    filters.params,
  )).rows[0].count;
  return paginated(rows, total, { page, pageSize });
}

/** Updates the per-site publication counters after a publish run. */
export async function applyPublicationOutcome(siteId, { succeeded = 0, failed = 0, lastError = null }) {
  if (!succeeded && !failed) return;
  await query(
    `UPDATE sites SET
       publication_success_count=publication_success_count+$2,
       publication_failure_count=publication_failure_count+$3,
       last_publication_at=CASE WHEN $2>0 THEN NOW() ELSE last_publication_at END,
       last_failure_at=CASE WHEN $3>0 THEN NOW() ELSE last_failure_at END,
       last_failure_message=CASE WHEN $3>0 THEN $4 ELSE last_failure_message END
     WHERE id=$1`,
    [siteId, succeeded, failed, lastError ? String(lastError).slice(0, 500) : null],
  );
}

export async function saveConnection(userId, platform, name, credentials, settings, key) {
  const encrypted = encryptText(JSON.stringify(credentials), key);
  return (await query(
    `INSERT INTO platform_connections(user_id,platform,name,credentials_encrypted,settings)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(user_id,platform,name)
     DO UPDATE SET credentials_encrypted=EXCLUDED.credentials_encrypted,settings=EXCLUDED.settings,updated_at=NOW()
     RETURNING id,platform,name,status,settings`,
    [userId, platform, name, encrypted, JSON.stringify(settings || {})],
  )).rows[0];
}

export { tx };

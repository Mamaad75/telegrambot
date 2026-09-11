import { query } from "../db/db.js";
import { Filters, parsePagination, paginated } from "../utils/pagination.js";
import { maskPhone } from "../utils/security.js";

/**
 * Publication history + diagnostics, shared by the web admin and the bot.
 *
 * Everything leaving this module passes through `sanitize`, which strips phone
 * numbers and credential-shaped values out of publication metadata before an
 * admin surface ever sees them.
 */

const SENSITIVE_METADATA = /(phone|mobile|token|secret|credential|api[_-]?key|password|access[_-]?token)/i;

export function sanitizeMetadata(metadata, { allowPhone = false } = {}) {
  if (!metadata || typeof metadata !== "object") return {};
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => {
    if (!SENSITIVE_METADATA.test(key)) return [key, value];
    if (allowPhone && /(phone|mobile)/i.test(key)) return [key, maskPhone(value)];
    return [key, "[REDACTED]"];
  }));
}

function shape(row, options = {}) {
  if (!row) return null;
  const { contact_phone_enc: _enc, ...rest } = row;
  return {
    ...rest,
    metadata: sanitizeMetadata(row.metadata, options),
    // The advertiser phone is stored encrypted and is never part of a list
    // response; this flag lets the UI say "a contact number exists" honestly.
    has_contact_phone: Boolean(row.contact_phone_enc),
  };
}

export async function listPublications(input = {}, options = {}) {
  const { page, pageSize, limit, offset } = parsePagination(input);
  const filters = new Filters();

  filters
    .add("p.site_id = ?", input.site_id)
    .add("p.post_id = ?", input.post_id)
    .add("p.platform = ?", input.platform)
    .add("p.event_type = ?", input.event_type)
    .add("p.status = ?", input.status)
    .add("p.created_at >= ?", input.from)
    .add("p.created_at <= ?", input.to);

  if (input.only_failed === true || input.only_failed === "true") filters.addRaw("p.status = 'failed'");
  if (input.q) {
    const term = filters.next(`%${String(input.q).trim()}%`);
    filters.addRaw(`(p.post_id ILIKE ${term} OR p.error_message ILIKE ${term} OR p.site_id ILIKE ${term})`);
  }

  const where = filters.where();
  const rows = (await query(
    `SELECT p.id,p.site_id,p.post_id,p.event_type,p.platform,p.status,p.external_message_ids,
            p.error_message,p.error_code,p.duration_ms,p.attempt_count,p.published_at,p.created_at,
            p.updated_at,p.metadata,p.contact_phone_enc,
            s.name AS site_name
       FROM publications p
       LEFT JOIN sites s ON s.id = p.site_id
       ${where}
      ORDER BY p.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    filters.params,
  )).rows;

  const total = (await query(
    `SELECT COUNT(*)::int AS count FROM publications p ${where}`,
    filters.params,
  )).rows[0].count;

  return paginated(rows.map((row) => shape(row, options)), total, { page, pageSize });
}

export async function getPublication(id, options = {}) {
  const row = (await query(
    `SELECT p.*, s.name AS site_name, s.wordpress_url
       FROM publications p LEFT JOIN sites s ON s.id=p.site_id
      WHERE p.id=$1`,
    [Number(id)],
  )).rows[0];
  if (!row) return null;

  const retry = (await query(
    `SELECT id,status,attempts,max_attempts,next_attempt_at,last_error,requested_by,created_at,updated_at
       FROM publication_retries
      WHERE site_id=$1 AND post_id=$2 AND event_type=$3 AND platform=$4
      ORDER BY id DESC LIMIT 1`,
    [row.site_id, row.post_id, row.event_type, row.platform],
  )).rows[0] || null;

  return { ...shape(row, options), retry, retry_eligible: isRetryEligible(row) };
}

/**
 * A publication may be retried when it actually failed and the event type is
 * one that can be re-sent. Deletions are re-driven through the deletion path,
 * not the publish path, so they are not retried here.
 */
export function isRetryEligible(publication) {
  if (!publication) return false;
  if (publication.status !== "failed") return false;
  return ["created", "published", "updated"].includes(String(publication.event_type));
}

/** Counters for the dashboard's publication cards and platform distribution. */
export async function publicationSummary({ timezone = "UTC" } = {}) {
  const rows = (await query(
    `SELECT
       COUNT(*) FILTER (WHERE status='published')::int AS published,
       COUNT(*) FILTER (WHERE status='failed')::int    AS failed,
       COUNT(*) FILTER (WHERE status='skipped')::int   AS skipped,
       COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1)::int AS today,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7_days
     FROM publications`,
    [timezone],
  )).rows[0];
  return rows;
}

export async function platformDistribution() {
  return (await query(
    `SELECT platform,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status='published')::int AS published,
            COUNT(*) FILTER (WHERE status='failed')::int AS failed
       FROM publications GROUP BY platform ORDER BY total DESC`,
  )).rows;
}

export async function recentFailures(limit = 10) {
  return (await query(
    `SELECT p.id,p.site_id,s.name AS site_name,p.post_id,p.platform,p.event_type,
            p.error_message,p.error_code,p.created_at
       FROM publications p LEFT JOIN sites s ON s.id=p.site_id
      WHERE p.status='failed'
      ORDER BY p.id DESC LIMIT $1`,
    [Math.min(50, Math.max(1, Number(limit) || 10))],
  )).rows;
}

export async function recentPublications(limit = 10) {
  return (await query(
    `SELECT p.id,p.site_id,s.name AS site_name,p.post_id,p.platform,p.event_type,p.status,
            p.published_at,p.created_at
       FROM publications p LEFT JOIN sites s ON s.id=p.site_id
      ORDER BY p.id DESC LIMIT $1`,
    [Math.min(50, Math.max(1, Number(limit) || 10))],
  )).rows;
}

/** Daily publication volume for the dashboard chart, in the display timezone. */
export async function dailyVolume(days = 14, timezone = "UTC") {
  return (await query(
    `SELECT to_char(date_trunc('day', created_at AT TIME ZONE $2), 'YYYY-MM-DD') AS day,
            COUNT(*) FILTER (WHERE status='published')::int AS published,
            COUNT(*) FILTER (WHERE status='failed')::int    AS failed
       FROM publications
      WHERE created_at >= NOW() - ($1||' days')::interval
      GROUP BY 1 ORDER BY 1 ASC`,
    [String(Math.min(90, Math.max(1, Number(days) || 14))), timezone],
  )).rows;
}

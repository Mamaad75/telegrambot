import { query } from "../db/db.js";
import { Filters, parsePagination, paginated } from "../utils/pagination.js";
import { maskPhone } from "../utils/security.js";

/**
 * Customer (end-user) administration.
 *
 * Phone numbers are the one field here that never leaves by default: list
 * responses omit them entirely, and detail responses only include a value when
 * the caller was granted users.phone.view — otherwise a masked form is shown.
 */

function shape(row, { includePhone = false } = {}) {
  if (!row) return null;
  const { phone, ...rest } = row;
  const shaped = {
    ...rest,
    has_phone: Boolean(phone),
    phone_masked: phone ? maskPhone(phone) : "",
  };
  // The key is absent, not undefined: a caller without the permission cannot
  // find a phone field at all, in JS or in JSON.
  if (includePhone) shaped.phone = phone || "";
  return shaped;
}

export async function listUsers(input = {}) {
  const { page, pageSize, limit, offset } = parsePagination(input);
  const filters = new Filters();
  filters.add("u.status = ?", input.status);

  if (input.q) {
    const term = filters.next(`%${String(input.q).trim()}%`);
    filters.addRaw(`(u.display_name ILIKE ${term} OR u.username ILIKE ${term} OR EXISTS (
      SELECT 1 FROM identities i WHERE i.user_id=u.id AND i.platform_user_id ILIKE ${term}))`);
  }
  if (input.telegram_id) {
    const value = filters.next(String(input.telegram_id));
    filters.addRaw(`EXISTS (SELECT 1 FROM identities i WHERE i.user_id=u.id AND i.platform='telegram' AND i.platform_user_id=${value})`);
  }
  if (input.subscription === "active") {
    filters.addRaw("sub.status='active' AND sub.expires_at > NOW()");
  }
  if (input.subscription === "expired") {
    filters.addRaw("(sub.id IS NULL OR sub.expires_at <= NOW())");
  }

  const where = filters.where();
  const rows = (await query(
    `SELECT u.id,u.display_name,u.username,u.status,u.created_at,u.last_seen_at,
            tg.platform_user_id AS telegram_id,
            sub.plan_id AS subscription_plan, sub.status AS subscription_status,
            sub.expires_at AS subscription_expires_at,
            (SELECT COUNT(*)::int FROM sites s WHERE s.owner_user_id=u.id) AS site_count
       FROM users u
       LEFT JOIN LATERAL (
         SELECT platform_user_id FROM identities
          WHERE user_id=u.id AND platform='telegram' ORDER BY id ASC LIMIT 1
       ) tg ON true
       LEFT JOIN LATERAL (
         SELECT id,plan_id,status,expires_at FROM subscriptions
          WHERE user_id=u.id ORDER BY expires_at DESC LIMIT 1
       ) sub ON true
       ${where}
      ORDER BY u.id DESC LIMIT ${limit} OFFSET ${offset}`,
    filters.params,
  )).rows;

  const total = (await query(
    `SELECT COUNT(*)::int AS count FROM users u
       LEFT JOIN LATERAL (
         SELECT id,status,expires_at FROM subscriptions WHERE user_id=u.id ORDER BY expires_at DESC LIMIT 1
       ) sub ON true
     ${where}`,
    filters.params,
  )).rows[0].count;

  // Lists never carry phone numbers, whatever the caller's role.
  return paginated(rows.map((row) => shape(row, { includePhone: false })), total, { page, pageSize });
}

export async function getUserDetail(userId, { includePhone = false } = {}) {
  const user = (await query(
    "SELECT id,display_name,username,phone,status,created_at,updated_at,last_seen_at FROM users WHERE id=$1",
    [Number(userId)],
  )).rows[0];
  if (!user) return null;

  const [identities, subscriptions, invoices, sites, memberships, sessions] = await Promise.all([
    query("SELECT platform,platform_user_id,username,created_at FROM identities WHERE user_id=$1 ORDER BY id", [user.id]),
    query(
      `SELECT s.id,s.plan_id,p.name AS plan_name,s.status,s.starts_at,s.expires_at,s.source,s.invoice_id,s.created_at
         FROM subscriptions s JOIN plans p ON p.id=s.plan_id
        WHERE s.user_id=$1 ORDER BY s.id DESC LIMIT 20`,
      [user.id],
    ),
    query(
      `SELECT id,public_id,plan_id,amount_toman,status,payment_method,gateway,paid_at,created_at
         FROM invoices WHERE user_id=$1 ORDER BY id DESC LIMIT 20`,
      [user.id],
    ),
    query(
      `SELECT id,name,wordpress_url,enabled,last_publication_at FROM sites
        WHERE owner_user_id=$1 ORDER BY created_at DESC`,
      [user.id],
    ),
    query(
      `SELECT m.site_id,m.role,m.status,m.created_at,s.name AS site_name,s.wordpress_url
         FROM site_members m JOIN sites s ON s.id=m.site_id
        WHERE m.user_id=$1 ORDER BY s.name ASC`,
      [user.id],
    ),
    query(
      `SELECT id,platform,created_at,expires_at,revoked_at FROM app_sessions
        WHERE user_id=$1 ORDER BY id DESC LIMIT 20`,
      [user.id],
    ),
  ]);

  return {
    ...shape(user, { includePhone }),
    identities: identities.rows,
    subscriptions: subscriptions.rows,
    invoices: invoices.rows,
    sites: sites.rows,
    memberships: memberships.rows,
    sessions: sessions.rows.map((session) => ({
      ...session,
      active: !session.revoked_at && new Date(session.expires_at) > new Date(),
    })),
  };
}

export async function setUserStatus(userId, status) {
  if (!["active", "suspended"].includes(status)) throw new Error("Invalid user status");
  const row = (await query(
    "UPDATE users SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING id,status",
    [Number(userId), status],
  )).rows[0];
  // A suspended customer must not keep a live Mini App session.
  if (row && status === "suspended") await revokeUserSessions(userId);
  return row || null;
}

export async function revokeUserSessions(userId) {
  const result = await query(
    "UPDATE app_sessions SET revoked_at=NOW(),expires_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW()",
    [Number(userId)],
  );
  return result.rowCount;
}

export async function findUserByTelegramId(telegramId) {
  return (await query(
    `SELECT u.id,u.display_name,u.username,u.status
       FROM users u JOIN identities i ON i.user_id=u.id
      WHERE i.platform='telegram' AND i.platform_user_id=$1`,
    [String(telegramId)],
  )).rows[0] || null;
}

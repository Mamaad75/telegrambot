import { query } from "../db/db.js";
import { getSite } from "./clients.js";
import { logger } from "../logger.js";

/**
 * Site membership.
 *
 * One place decides who may act on a site and with what authority, because the
 * same question is asked from three surfaces — the admin API, the customer API
 * and the Mini App — and three copies of the rule would drift.
 *
 * The model:
 *   owner    sites.owner_user_id. Exactly one, never a site_members row.
 *   admin    a member who may manage the site and its other members.
 *   support  a member who may work the site (tickets, publications) but may
 *            not change who has access.
 *
 * Members are added by platform id, not by internal user id: an operator knows
 * a Telegram or Bale id, not a row number, and the identity must already exist
 * (the person has started the bot) so that we never invite a stranger into a
 * site by typing a number that nobody has claimed.
 */

export const MEMBER_ROLES = Object.freeze(["admin", "support"]);
/** Roles that can be handed out by quick-assign, which can also move ownership. */
export const ASSIGNABLE_ROLES = Object.freeze(["owner", "admin", "support"]);
const LOOKUP_PLATFORMS = Object.freeze(["telegram", "bale"]);

export class MemberError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MemberError";
    this.code = code;
    this.status = status;
  }
}

const badRequest = (code, message) => new MemberError(code, message, 400);

function normalizeRole(role, allowed = MEMBER_ROLES) {
  const value = String(role || "").trim().toLowerCase();
  if (!allowed.includes(value)) {
    throw badRequest("invalid_role", `نقش نامعتبر است (${allowed.join("، ")})`);
  }
  return value;
}

function normalizePlatform(platform) {
  const value = String(platform || "").trim().toLowerCase();
  if (!LOOKUP_PLATFORMS.includes(value)) {
    throw badRequest("invalid_platform", "پلتفرم باید telegram یا bale باشد");
  }
  return value;
}

/**
 * Finds the Jarchi user behind a platform id.
 *
 * A missing identity is a distinct, expected outcome — the person simply has
 * not opened the bot yet — so it gets its own code the UI can turn into an
 * instruction rather than a generic failure.
 */
export async function findUserByPlatformId(platform, platformUserId) {
  const normalized = normalizePlatform(platform);
  const id = String(platformUserId || "").trim();
  if (!/^[0-9]{1,32}$/.test(id)) {
    throw badRequest("invalid_platform_user_id", "شناسه کاربر باید فقط عدد باشد");
  }

  const row = (await query(
    `SELECT u.id,u.display_name,u.username,u.status,i.platform,i.platform_user_id
       FROM identities i JOIN users u ON u.id=i.user_id
      WHERE i.platform=$1 AND i.platform_user_id=$2 LIMIT 1`,
    [normalized, id],
  )).rows[0] || null;

  if (!row) {
    throw new MemberError(
      "identity_not_found",
      "این کاربر هنوز ربات را استارت نکرده است. ابتدا باید ربات را باز کند.",
      404,
    );
  }
  if (row.status !== "active") {
    throw new MemberError("user_inactive", "این حساب کاربری غیرفعال است", 409);
  }
  return row;
}

/** Owner plus members, in one shape, newest membership last. */
export async function listMembers(siteId) {
  const site = await requireSite(siteId);

  const owner = site.owner_user_id
    ? (await query(
        `SELECT id,display_name,username,status FROM users WHERE id=$1`,
        [Number(site.owner_user_id)],
      )).rows[0] || null
    : null;

  const members = (await query(
    `SELECT m.user_id,m.role,m.status,m.created_at,m.updated_at,
            u.display_name,u.username,u.status AS user_status
       FROM site_members m JOIN users u ON u.id=m.user_id
      WHERE m.site_id=$1
      ORDER BY m.created_at ASC, m.id ASC`,
    [site.id],
  )).rows;

  const identities = await identitiesFor([
    ...(owner ? [owner.id] : []),
    ...members.map((row) => row.user_id),
  ]);

  const shape = (row, role, extra = {}) => ({
    user_id: Number(row.user_id ?? row.id),
    display_name: row.display_name || "",
    username: row.username || "",
    role,
    status: extra.status || "active",
    user_status: row.user_status || row.status || "active",
    identities: identities.get(Number(row.user_id ?? row.id)) || [],
    created_at: extra.created_at || null,
    updated_at: extra.updated_at || null,
  });

  return {
    site_id: site.id,
    owner: owner ? shape(owner, "owner") : null,
    members: members.map((row) => shape(row, row.role, row)),
  };
}

/** Platform ids per user, so a screen can show what an operator recognises. */
async function identitiesFor(userIds) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = (await query(
    `SELECT user_id,platform,platform_user_id FROM identities WHERE user_id = ANY($1::bigint[])`,
    [ids],
  )).rows;
  const map = new Map();
  for (const row of rows) {
    const list = map.get(Number(row.user_id)) || [];
    list.push({ platform: row.platform, platform_user_id: row.platform_user_id });
    map.set(Number(row.user_id), list);
  }
  return map;
}

async function requireSite(siteId) {
  const site = await getSite(String(siteId || "").trim());
  if (!site) throw new MemberError("site_not_found", "سایت یافت نشد", 404);
  return site;
}

/**
 * Adds or re-roles a member found by platform id.
 *
 * Adding the owner is refused rather than silently ignored: it would create a
 * second row claiming authority the owner already holds, and an operator who
 * tried it deserves to know why nothing changed.
 */
export async function addMember(siteId, { platform, platform_user_id, role, actor = null }) {
  const site = await requireSite(siteId);
  const wanted = normalizeRole(role);
  const user = await findUserByPlatformId(platform, platform_user_id);

  if (String(site.owner_user_id ?? "") === String(user.id)) {
    throw new MemberError("already_owner", "این کاربر مالک سایت است", 409);
  }

  const row = (await query(
    `INSERT INTO site_members(site_id,user_id,role,status) VALUES($1,$2,$3,'active')
     ON CONFLICT(site_id,user_id) DO UPDATE
        SET role=EXCLUDED.role, status='active', updated_at=NOW()
     RETURNING user_id,role,status,created_at,updated_at`,
    [site.id, Number(user.id), wanted],
  )).rows[0];

  logger.info("site member added", {
    site_id: site.id, user_id: Number(user.id), role: wanted, actor: actor || null,
  });
  return { ...row, user_id: Number(row.user_id), display_name: user.display_name, username: user.username };
}

/**
 * Adds a member already known by internal id.
 *
 * Kept for the panel's existing "pick a user from the list" flow; the platform
 * id path above is what the Mini App uses, since an operator there is looking
 * at a Telegram or Bale id rather than a row number.
 */
export async function addMemberByUserId(siteId, userId, role, { actor = null } = {}) {
  const site = await requireSite(siteId);
  const wanted = normalizeRole(role);
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) throw badRequest("invalid_user_id", "شناسه کاربر نامعتبر است");

  const user = (await query("SELECT id,display_name,username,status FROM users WHERE id=$1", [id])).rows[0];
  if (!user) throw new MemberError("user_not_found", "کاربر یافت نشد", 404);
  if (user.status !== "active") throw new MemberError("user_inactive", "این حساب کاربری غیرفعال است", 409);
  if (String(site.owner_user_id ?? "") === String(user.id)) {
    throw new MemberError("already_owner", "این کاربر مالک سایت است", 409);
  }

  const row = (await query(
    `INSERT INTO site_members(site_id,user_id,role,status) VALUES($1,$2,$3,'active')
     ON CONFLICT(site_id,user_id) DO UPDATE
        SET role=EXCLUDED.role, status='active', updated_at=NOW()
     RETURNING user_id,role,status,created_at,updated_at`,
    [site.id, id, wanted],
  )).rows[0];

  logger.info("site member added", { site_id: site.id, user_id: id, role: wanted, actor });
  return { ...row, user_id: Number(row.user_id), display_name: user.display_name, username: user.username };
}

export async function setMemberRole(siteId, userId, role, { actor = null } = {}) {
  const site = await requireSite(siteId);
  const wanted = normalizeRole(role);
  const row = (await query(
    `UPDATE site_members SET role=$3, updated_at=NOW()
      WHERE site_id=$1 AND user_id=$2
      RETURNING user_id,role,status,created_at,updated_at`,
    [site.id, Number(userId), wanted],
  )).rows[0];
  if (!row) throw new MemberError("member_not_found", "این کاربر عضو سایت نیست", 404);

  logger.info("site member role changed", { site_id: site.id, user_id: Number(userId), role: wanted, actor });
  return { ...row, user_id: Number(row.user_id) };
}

export async function removeMember(siteId, userId, { actor = null } = {}) {
  const site = await requireSite(siteId);
  const result = await query(
    `DELETE FROM site_members WHERE site_id=$1 AND user_id=$2`,
    [site.id, Number(userId)],
  );
  if (!result.rowCount) throw new MemberError("member_not_found", "این کاربر عضو سایت نیست", 404);

  logger.info("site member removed", { site_id: site.id, user_id: Number(userId), actor });
  return { removed: true, site_id: site.id, user_id: Number(userId) };
}

/**
 * Quick assign: grant access to a site by platform id in one step.
 *
 * `owner` is a transfer, not an addition. The previous owner is demoted to
 * admin rather than dropped, because an operator moving ownership almost never
 * means "and revoke the founder's access", and losing it silently would be
 * hard to notice and awkward to undo.
 */
export async function assignRole({ platform, platform_user_id, site_id, role, actor = null }) {
  const site = await requireSite(site_id);
  const wanted = normalizeRole(role, ASSIGNABLE_ROLES);
  const user = await findUserByPlatformId(platform, platform_user_id);

  if (wanted !== "owner") {
    const member = await addMember(site.id, { platform, platform_user_id, role: wanted, actor });
    return { site_id: site.id, user_id: Number(user.id), role: wanted, member, previous_owner_user_id: null };
  }

  const previousOwner = site.owner_user_id ? Number(site.owner_user_id) : null;
  if (previousOwner === Number(user.id)) {
    return { site_id: site.id, user_id: Number(user.id), role: "owner", member: null, previous_owner_user_id: previousOwner };
  }

  await query("UPDATE sites SET owner_user_id=$2, updated_at=NOW() WHERE id=$1", [site.id, Number(user.id)]);
  // The new owner's membership row would now contradict sites.owner_user_id.
  await query("DELETE FROM site_members WHERE site_id=$1 AND user_id=$2", [site.id, Number(user.id)]);
  if (previousOwner) {
    await query(
      `INSERT INTO site_members(site_id,user_id,role,status) VALUES($1,$2,'admin','active')
       ON CONFLICT(site_id,user_id) DO UPDATE SET role='admin', status='active', updated_at=NOW()`,
      [site.id, previousOwner],
    );
  }

  logger.info("site ownership transferred", {
    site_id: site.id, user_id: Number(user.id), previous_owner_user_id: previousOwner, actor,
  });
  return { site_id: site.id, user_id: Number(user.id), role: "owner", member: null, previous_owner_user_id: previousOwner };
}

/**
 * The role a user holds on a site, or "" when they hold none.
 * Used by the customer API, where authority comes from membership alone.
 */
export async function roleFor(siteId, userId) {
  const site = await getSite(String(siteId || "").trim());
  if (!site) return "";
  if (String(site.owner_user_id ?? "") === String(userId)) return "owner";
  const row = (await query(
    `SELECT role FROM site_members WHERE site_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,
    [site.id, Number(userId)],
  )).rows[0];
  return row?.role || "";
}

/** Managing membership is an owner/admin action; support is explicitly excluded. */
export function canManageMembers(role) {
  return ["owner", "admin"].includes(String(role || "").toLowerCase());
}

/** The last role grants across all sites, for the quick-assign screen. */
export async function recentAssignments(limit = 10) {
  const bounded = Math.min(50, Math.max(1, Number(limit) || 10));
  return (await query(
    `SELECT a.action,a.target_id AS site_id,a.metadata,a.created_at,a.success,
            a.actor_label,a.actor_role,s.name AS site_name
       FROM admin_audit_log a
       LEFT JOIN sites s ON s.id = a.target_id
      WHERE a.action IN ('site.role.assign','site.member.add','site.member.role','site.member.remove')
      ORDER BY a.created_at DESC
      LIMIT $1`,
    [bounded],
  )).rows;
}

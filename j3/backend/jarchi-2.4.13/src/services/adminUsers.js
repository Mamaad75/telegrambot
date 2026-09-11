import crypto from "node:crypto";
import { query } from "../db/db.js";
import { config } from "../config.js";
import { hashPassword, verifyPassword, randomToken, sha256 } from "../utils/security.js";
import { isRole, permissionsForRole } from "../core/rbac.js";
import { logger } from "../logger.js";
import { Filters, parsePagination, paginated } from "../utils/pagination.js";

const PUBLIC_COLUMNS = `id,username,display_name,role,status,telegram_user_id,bale_user_id,
  last_login_at,locked_until,failed_attempts,created_at,updated_at`;

export class AuthenticationError extends Error {
  constructor(message, code = "invalid_credentials") {
    super(message);
    this.name = "AuthenticationError";
    this.status = 401;
    this.code = code;
  }
}

function shape(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    status: row.status,
    telegram_user_id: row.telegram_user_id || null,
    bale_user_id: row.bale_user_id || null,
    last_login_at: row.last_login_at || null,
    locked_until: row.locked_until || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    permissions: permissionsForRole(row.role),
  };
}

/* ------------------------------------------------------------------ *
 * Accounts
 * ------------------------------------------------------------------ */

export async function listAdmins(input = {}) {
  const { page, pageSize, limit, offset } = parsePagination(input);
  const filters = new Filters();
  filters.add("role = ?", isRole(input.role) ? input.role : undefined)
    .add("status = ?", input.status);
  if (input.q) {
    const term = filters.next(`%${String(input.q).trim()}%`);
    filters.addRaw(`(username ILIKE ${term} OR display_name ILIKE ${term})`);
  }
  const where = filters.where();
  const rows = (await query(
    `SELECT ${PUBLIC_COLUMNS} FROM admin_users ${where} ORDER BY id ASC LIMIT ${limit} OFFSET ${offset}`,
    filters.params,
  )).rows.map(shape);
  const total = (await query(`SELECT COUNT(*)::int AS count FROM admin_users ${where}`, filters.params)).rows[0].count;
  return paginated(rows, total, { page, pageSize });
}

export async function getAdmin(id) {
  return shape((await query(`SELECT ${PUBLIC_COLUMNS} FROM admin_users WHERE id=$1`, [Number(id)])).rows[0]);
}

export async function findAdminByTelegramId(telegramUserId) {
  const id = String(telegramUserId || "").trim();
  if (!id) return null;
  return shape((await query(
    `SELECT ${PUBLIC_COLUMNS} FROM admin_users WHERE telegram_user_id=$1`,
    [id],
  )).rows[0]);
}


export async function findAdminByBaleId(baleUserId) {
  const id = String(baleUserId || "").trim();
  if (!id) return null;
  return shape((await query(
    `SELECT ${PUBLIC_COLUMNS} FROM admin_users WHERE bale_user_id=$1`,
    [id],
  )).rows[0]);
}

export async function createAdmin({ username, password, role, display_name = "", telegram_user_id = null, bale_user_id = null, created_by = null }) {
  const name = String(username || "").trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(name)) {
    throw new Error("Username must be 3-40 characters of letters, digits, dot, dash or underscore");
  }
  if (!isRole(role)) throw new Error("Invalid role");

  const passwordHash = password ? hashPassword(password) : null;
  const telegram = telegram_user_id ? String(telegram_user_id).trim() : null;
  const bale = bale_user_id ? String(bale_user_id).trim() : null;
  if (telegram && !/^\d{3,20}$/.test(telegram)) throw new Error("Invalid Telegram user id");
  if (bale && !/^\d{3,20}$/.test(bale)) throw new Error("Invalid Bale user id");
  if (!passwordHash && !telegram && !bale) throw new Error("An admin needs a password, a Telegram id, a Bale id, or both");

  try {
    const row = (await query(
      `INSERT INTO admin_users(username,display_name,password_hash,role,status,telegram_user_id,bale_user_id,created_by)
       VALUES($1,$2,$3,$4,'active',$5,$6,$7) RETURNING ${PUBLIC_COLUMNS}`,
      [name, String(display_name || name), passwordHash, role, telegram, bale, created_by],
    )).rows[0];
    logger.info("admin account created", { admin_id: row.id, username: row.username, role: row.role });
    return shape(row);
  } catch (error) {
    if (error.code === "23505") throw new Error("An admin with this username, Telegram id, or Bale id already exists");
    throw error;
  }
}

export async function updateAdmin(id, patch = {}) {
  const current = await getAdmin(id);
  if (!current) throw new Error("Admin not found");

  const updates = [];
  const params = [];
  const push = (sql, value) => { params.push(value); updates.push(sql.replace("?", `$${params.length}`)); };

  if (patch.display_name !== undefined) push("display_name=?", String(patch.display_name));
  if (patch.role !== undefined) {
    if (!isRole(patch.role)) throw new Error("Invalid role");
    push("role=?", patch.role);
  }
  if (patch.status !== undefined) {
    if (!["active", "disabled"].includes(patch.status)) throw new Error("Invalid status");
    push("status=?", patch.status);
  }
  if (patch.bale_user_id !== undefined) {
    const bale = patch.bale_user_id ? String(patch.bale_user_id).trim() : null;
    if (bale && !/^\d{3,20}$/.test(bale)) throw new Error("Invalid Bale user id");
    push("bale_user_id=?", bale);
  }
  if (patch.telegram_user_id !== undefined) {
    const telegram = patch.telegram_user_id ? String(patch.telegram_user_id).trim() : null;
    if (telegram && !/^\d{3,20}$/.test(telegram)) throw new Error("Invalid Telegram user id");
    push("telegram_user_id=?", telegram);
  }
  if (patch.password) {
    push("password_hash=?", hashPassword(patch.password));
    push("failed_attempts=?", 0);
    push("locked_until=?", null);
  }
  if (!updates.length) return current;

  params.push(Number(id));
  const row = (await query(
    `UPDATE admin_users SET ${updates.join(",")},updated_at=NOW() WHERE id=$${params.length}
     RETURNING ${PUBLIC_COLUMNS}`,
    params,
  )).rows[0];

  // A disabled or demoted admin must lose their live sessions immediately.
  if (patch.status === "disabled" || patch.role || patch.password) await revokeAllSessions(id);
  return shape(row);
}

export async function countActiveSuperAdmins(excludeId = null) {
  return (await query(
    `SELECT COUNT(*)::int AS count FROM admin_users
     WHERE role='super_admin' AND status='active' AND ($1::bigint IS NULL OR id<>$1)`,
    [excludeId ? Number(excludeId) : null],
  )).rows[0].count;
}

/**
 * Creates the first super admin when the table is empty, from
 * ADMIN_BOOTSTRAP_USERNAME/PASSWORD (and ADMIN_TELEGRAM_ID when set).
 * Returns null when an admin already exists — never overwrites one.
 */
export async function ensureBootstrapAdmin() {
  const existing = (await query("SELECT COUNT(*)::int AS count FROM admin_users")).rows[0].count;
  if (existing > 0) {
    // Keep the historical ADMIN_TELEGRAM_ID working by attaching it to the
    // first super admin that has no Telegram identity yet.
    const telegramId = config.admin.bootstrapTelegramId;
    const baleId = config.admin.bootstrapBaleId;
    if (telegramId && /^\d{3,20}$/.test(telegramId)) {
      const claimed = (await query("SELECT 1 FROM admin_users WHERE telegram_user_id=$1", [telegramId])).rowCount;
      if (!claimed) {
        await query(
          `UPDATE admin_users SET telegram_user_id=$1,updated_at=NOW()
           WHERE id=(SELECT id FROM admin_users WHERE role='super_admin' AND telegram_user_id IS NULL ORDER BY id ASC LIMIT 1)`,
          [telegramId],
        );
      }
    }
    if (baleId && /^\d{3,20}$/.test(baleId)) {
      const claimed = (await query("SELECT 1 FROM admin_users WHERE bale_user_id=$1", [baleId])).rowCount;
      if (!claimed) {
        await query(
          `UPDATE admin_users SET bale_user_id=$1,updated_at=NOW()
           WHERE id=(SELECT id FROM admin_users WHERE role='super_admin' AND bale_user_id IS NULL ORDER BY id ASC LIMIT 1)`,
          [baleId],
        );
      }
    }
    return null;
  }

  const password = config.admin.bootstrapPassword;
  const telegramId = config.admin.bootstrapTelegramId;
  const baleId = config.admin.bootstrapBaleId;
  if (!password && !telegramId && !baleId) {
    logger.warn("no admin account exists and no bootstrap credentials are configured", {
      hint: "set ADMIN_BOOTSTRAP_PASSWORD and/or ADMIN_TELEGRAM_ID",
    });
    return null;
  }

  const admin = await createAdmin({
    username: config.admin.bootstrapUsername || "admin",
    password: password || null,
    role: "super_admin",
    display_name: "Jarchi Super Admin",
    telegram_user_id: /^\d{3,20}$/.test(telegramId) ? telegramId : null,
    bale_user_id: /^\d{3,20}$/.test(baleId) ? baleId : null,
  });
  logger.info("bootstrap super admin created", { admin_id: admin.id, username: admin.username });
  return admin;
}

/* ------------------------------------------------------------------ *
 * Login + sessions
 * ------------------------------------------------------------------ */

export async function authenticate(username, password, { ip = "", userAgent = "" } = {}) {
  const row = (await query(
    "SELECT id,username,display_name,password_hash,role,status,failed_attempts,locked_until FROM admin_users WHERE lower(username)=lower($1)",
    [String(username || "").trim()],
  )).rows[0];

  // Spend the same work on an unknown user so the response time does not
  // distinguish "no such account" from "wrong password".
  if (!row) {
    verifyPassword(String(password || ""), "scrypt$16384$8$1$decoy$decoy");
    throw new AuthenticationError("نام کاربری یا گذرواژه نادرست است");
  }
  if (row.status !== "active") throw new AuthenticationError("این حساب غیرفعال است", "account_disabled");
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    throw new AuthenticationError("حساب موقتاً قفل شده است؛ بعداً تلاش کنید", "account_locked");
  }
  if (!row.password_hash) throw new AuthenticationError("این حساب گذرواژه ندارد", "password_not_set");

  if (!verifyPassword(String(password || ""), row.password_hash)) {
    const attempts = Number(row.failed_attempts) + 1;
    const lock = attempts >= config.admin.loginMaxAttempts;
    await query(
      `UPDATE admin_users SET failed_attempts=$2,
         locked_until=CASE WHEN $3 THEN NOW() + ($4||' minutes')::interval ELSE locked_until END,
         updated_at=NOW()
       WHERE id=$1`,
      [row.id, lock ? 0 : attempts, lock, String(config.admin.loginLockMinutes)],
    );
    throw new AuthenticationError(
      lock ? "حساب به دلیل تلاش‌های ناموفق قفل شد" : "نام کاربری یا گذرواژه نادرست است",
      lock ? "account_locked" : "invalid_credentials",
    );
  }

  await query(
    "UPDATE admin_users SET failed_attempts=0,locked_until=NULL,last_login_at=NOW(),updated_at=NOW() WHERE id=$1",
    [row.id],
  );
  const admin = await getAdmin(row.id);
  const session = await createSession(admin.id, { ip, userAgent });
  return { admin, session };
}

/**
 * The CSRF token is derived from the session's identity rather than generated
 * randomly, so login and a later /auth/me hand back the same value and a
 * reloaded panel does not invalidate the token an open tab is still using.
 * It changes whenever the session itself rotates, since the id changes with it.
 */
function deriveCsrf(sessionId, issuedAt) {
  return crypto
    .createHmac("sha256", config.credentialKey || "jarchi-csrf-fallback")
    .update(`csrf:${sessionId}:${new Date(issuedAt).getTime()}`)
    .digest("base64url");
}

export function csrfForSession(session) {
  if (!session?.id || !session?.issued_at) return null;
  return deriveCsrf(session.id, session.issued_at);
}

export async function createSession(adminId, { ip = "", userAgent = "", rotatedFrom = null } = {}) {
  const token = randomToken(32);
  const row = (await query(
    `INSERT INTO admin_sessions(admin_user_id,token_hash,csrf_hash,ip,user_agent,expires_at,absolute_expires_at,rotated_from)
     VALUES($1,$2,'',$3,$4,NOW()+($5||' minutes')::interval,NOW()+($6||' hours')::interval,$7)
     RETURNING id,issued_at,expires_at,absolute_expires_at`,
    [
      Number(adminId), sha256(token),
      String(ip).slice(0, 64), String(userAgent).slice(0, 255),
      String(config.admin.sessionIdleMinutes), String(config.admin.sessionAbsoluteHours),
      rotatedFrom,
    ],
  )).rows[0];

  const csrf = deriveCsrf(row.id, row.issued_at);
  await query("UPDATE admin_sessions SET csrf_hash=$2 WHERE id=$1", [row.id, sha256(csrf)]);

  return {
    id: Number(row.id),
    token,
    csrf,
    expires_at: row.expires_at,
    absolute_expires_at: row.absolute_expires_at,
    issued_at: row.issued_at,
  };
}

/**
 * Validates a session token, enforcing idle and absolute expiry, then slides
 * the idle window. Returns null for anything expired, revoked or unknown.
 */
export async function resolveSession(token) {
  if (!token) return null;
  const row = (await query(
    `SELECT s.id,s.admin_user_id,s.csrf_hash,s.issued_at,s.expires_at,s.absolute_expires_at,s.revoked_at,
            a.username,a.display_name,a.role,a.status
       FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id
      WHERE s.token_hash=$1`,
    [sha256(token)],
  )).rows[0];

  if (!row) return null;
  const now = Date.now();
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= now) return null;
  if (new Date(row.absolute_expires_at).getTime() <= now) return null;
  if (row.status !== "active") return null;

  await query(
    `UPDATE admin_sessions
        SET last_seen_at=NOW(),
            expires_at=LEAST(NOW()+($2||' minutes')::interval, absolute_expires_at)
      WHERE id=$1`,
    [row.id, String(config.admin.sessionIdleMinutes)],
  );

  return {
    session: {
      id: Number(row.id),
      csrf_hash: row.csrf_hash,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      absolute_expires_at: row.absolute_expires_at,
    },
    actor: {
      id: Number(row.admin_user_id),
      username: row.username,
      display_name: row.display_name,
      role: row.role,
      status: row.status,
      permissions: permissionsForRole(row.role),
      channel: "web",
    },
  };
}

/** True when the session is old enough that its token should be reissued. */
export function shouldRotate(session) {
  const age = Date.now() - new Date(session.issued_at).getTime();
  return age >= config.admin.sessionRotateMinutes * 60000;
}

export async function rotateSession(session, adminId, context = {}) {
  const next = await createSession(adminId, { ...context, rotatedFrom: session.id });
  await query("UPDATE admin_sessions SET revoked_at=NOW() WHERE id=$1", [session.id]);
  return next;
}

export async function revokeSession(sessionId) {
  await query("UPDATE admin_sessions SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL", [Number(sessionId)]);
}

export async function revokeAllSessions(adminId) {
  const result = await query(
    "UPDATE admin_sessions SET revoked_at=NOW() WHERE admin_user_id=$1 AND revoked_at IS NULL",
    [Number(adminId)],
  );
  return result.rowCount;
}

export async function listSessions(adminId) {
  return (await query(
    `SELECT id,ip,user_agent,issued_at,last_seen_at,expires_at,revoked_at
       FROM admin_sessions WHERE admin_user_id=$1 ORDER BY id DESC LIMIT 50`,
    [Number(adminId)],
  )).rows;
}

/** Housekeeping: drop sessions and bot states that can no longer be used. */
export async function purgeExpiredSessions() {
  const sessions = await query("DELETE FROM admin_sessions WHERE absolute_expires_at < NOW() - INTERVAL '7 days'");
  const states = await query("DELETE FROM admin_bot_states WHERE expires_at < NOW() - INTERVAL '1 day'");
  return { sessions: sessions.rowCount, states: states.rowCount };
}

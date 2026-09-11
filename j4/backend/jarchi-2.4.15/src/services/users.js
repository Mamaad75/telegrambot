import { query } from "../db/db.js";
import { sha256, randomSecret, encryptText } from "../utils/security.js";

/** Customer identities and Mini App sessions. */

export async function upsertIdentity(platform, platformUserId, profile = {}) {
  const existing = await query(
    `SELECT u.* FROM users u JOIN identities i ON i.user_id=u.id
      WHERE i.platform=$1 AND i.platform_user_id=$2`,
    [platform, String(platformUserId)],
  );
  if (existing.rowCount) {
    const current = existing.rows[0];
    const updated = (await query(
      `UPDATE users SET
         display_name=COALESCE(NULLIF($2,''),display_name),
         username=COALESCE(NULLIF($3,''),username),
         phone=COALESCE(NULLIF($4,''),phone),
         last_seen_at=NOW(),updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [current.id, profile.display_name || "", profile.username || "", profile.phone || ""],
    )).rows[0];
    await query(
      `UPDATE identities SET username=COALESCE(NULLIF($3,''),username),raw_profile=$4
        WHERE user_id=$1 AND platform=$2`,
      [current.id, platform, profile.username || "", JSON.stringify(profile || {})],
    );
    return updated;
  }

  const user = (await query(
    "INSERT INTO users(display_name,username,phone,last_seen_at) VALUES($1,$2,$3,NOW()) RETURNING *",
    [profile.display_name || "", profile.username || "", profile.phone || ""],
  )).rows[0];
  await query(
    "INSERT INTO identities(user_id,platform,platform_user_id,username,raw_profile) VALUES($1,$2,$3,$4,$5)",
    [user.id, platform, String(platformUserId), profile.username || "", JSON.stringify(profile)],
  );
  return user;
}

export async function createSession(userId, platform, hours = 24) {
  const token = randomSecret("ses");
  await query(
    `INSERT INTO app_sessions(user_id,token_hash,platform,expires_at)
     VALUES($1,$2,$3,NOW()+($4||' hours')::interval)`,
    [userId, sha256(token), platform, String(hours)],
  );
  return token;
}

/**
 * Resolves a Mini App session. Revoked sessions and suspended customers are
 * rejected here, so revoking access from the admin panel takes effect at once.
 */
export async function getUserBySession(token) {
  return (await query(
    `SELECT u.*, s.platform FROM app_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>NOW() AND s.revoked_at IS NULL AND u.status='active'`,
    [sha256(token)],
  )).rows[0] || null;
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

/** Keeps the launch-session table bounded; expired/revoked credentials are unusable anyway. */
export async function purgeExpiredCustomerSessions() {
  const result = await query(
    `DELETE FROM app_sessions WHERE expires_at < NOW() - INTERVAL '1 day' OR revoked_at IS NOT NULL`,
  );
  return result.rowCount || 0;
}

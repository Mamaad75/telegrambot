import { query, tx } from "../db/db.js";
import { randomToken, sha256 } from "../utils/security.js";
import { getTelegramBotInfo } from "../platforms/telegram.js";
import { getBaleBotInfo } from "../platforms/bale.js";
import { logger } from "../logger.js";

const PLATFORMS = Object.freeze(["telegram", "bale"]);
const LINK_TTL_MINUTES = 10;
const MAX_ACTIVE_CHALLENGES = 5;
const BOT_CACHE_TTL_MS = 5 * 60_000;
const botCache = new Map();

function platformValue(platform) {
  const value = String(platform || "").trim().toLowerCase();
  if (!PLATFORMS.includes(value)) {
    const error = new Error("پلتفرم باید telegram یا bale باشد");
    error.status = 400;
    error.code = "invalid_platform";
    throw error;
  }
  return value;
}

function linkToken() {
  return `link_${randomToken(24)}`;
}

async function getBotUsername(platform) {
  const cached = botCache.get(platform);
  if (cached && cached.expiresAt > Date.now()) return cached.username;

  const info = platform === "telegram" ? await getTelegramBotInfo() : await getBaleBotInfo();
  const username = String(info?.username || "").replace(/^@/, "").trim();
  if (!username) {
    const error = new Error(`نام کاربری ربات ${platform} در دسترس نیست`);
    error.status = 503;
    error.code = "bot_username_unavailable";
    throw error;
  }
  botCache.set(platform, { username, expiresAt: Date.now() + BOT_CACHE_TTL_MS });
  return username;
}

export async function listIdentities(userId) {
  return (await query(
    `SELECT platform,platform_user_id,username,created_at
       FROM identities
      WHERE user_id=$1
      ORDER BY CASE platform WHEN 'telegram' THEN 0 WHEN 'bale' THEN 1 ELSE 2 END, id ASC`,
    [Number(userId)],
  )).rows;
}

export async function getUnifiedAccount(userId) {
  const identities = await listIdentities(userId);
  const byPlatform = Object.fromEntries(PLATFORMS.map((platform) => [platform, null]));
  for (const identity of identities) byPlatform[identity.platform] = identity;

  const sessions = (await query(
    `SELECT platform,COUNT(*)::int AS active_sessions
       FROM app_sessions
      WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW()
      GROUP BY platform`,
    [Number(userId)],
  )).rows;

  const sessionCounts = Object.fromEntries(sessions.map((row) => [row.platform, Number(row.active_sessions)]));
  return {
    user_id: Number(userId),
    unified: Boolean(byPlatform.telegram && byPlatform.bale),
    identities: byPlatform,
    active_sessions: sessionCounts,
  };
}

/** Create a one-time challenge that must be completed by the target platform bot. */
export async function createLinkChallenge(userId, sourcePlatform, targetPlatform) {
  const source = platformValue(sourcePlatform);
  const target = platformValue(targetPlatform);
  if (source === target) {
    const error = new Error("نمی‌توانید همان پلتفرم را دوباره متصل کنید");
    error.status = 409;
    error.code = "same_platform";
    throw error;
  }

  const account = await getUnifiedAccount(userId);
  if (account.identities[target]) {
    const error = new Error(`حساب ${target === "telegram" ? "تلگرام" : "بله"} از قبل متصل است`);
    error.status = 409;
    error.code = "already_linked";
    throw error;
  }

  await query(
    `UPDATE account_link_challenges SET status='expired'
      WHERE source_user_id=$1 AND status='pending' AND expires_at<=NOW()`,
    [Number(userId)],
  );
  const active = await query(
    `SELECT COUNT(*)::int AS count FROM account_link_challenges
      WHERE source_user_id=$1 AND status='pending' AND expires_at>NOW()`,
    [Number(userId)],
  );
  if (Number(active.rows[0]?.count || 0) >= MAX_ACTIVE_CHALLENGES) {
    const error = new Error("تعداد درخواست‌های اتصال فعال زیاد است؛ یکی از لینک‌های قبلی را استفاده کنید");
    error.status = 429;
    error.code = "too_many_link_challenges";
    throw error;
  }

  const token = linkToken();
  await query(
    `INSERT INTO account_link_challenges(
       token_hash,source_user_id,source_platform,target_platform,expires_at,status
     ) VALUES($1,$2,$3,$4,NOW()+($5||' minutes')::interval,'pending')`,
    [sha256(token), Number(userId), source, target, String(LINK_TTL_MINUTES)],
  );

  const username = await getBotUsername(target);
  const deepLink = target === "telegram"
    ? `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(token)}`
    : `https://ble.ir/${encodeURIComponent(username)}?start=${encodeURIComponent(token)}`;

  logger.info("account link challenge created", {
    user_id: Number(userId), source_platform: source, target_platform: target,
    expires_in_minutes: LINK_TTL_MINUTES,
  });

  return { target_platform: target, deep_link: deepLink, expires_in_seconds: LINK_TTL_MINUTES * 60 };
}

function normalizeProfile(profile = {}) {
  return {
    display_name: String(profile.display_name || "").slice(0, 200),
    username: String(profile.username || "").slice(0, 200),
    raw_profile: JSON.stringify(profile),
  };
}

/**
 * Completes a pending cross-platform link from the target bot update.
 * The target identity is never silently moved between Jarchi accounts.
 */
export async function completeLinkFromBot(targetPlatform, platformUserId, profile = {}, token) {
  const target = platformValue(targetPlatform);
  const cleanToken = String(token || "").trim();
  if (!/^link_[A-Za-z0-9_-]{20,80}$/.test(cleanToken)) {
    const error = new Error("لینک اتصال نامعتبر یا منقضی است");
    error.status = 400;
    error.code = "invalid_link_token";
    throw error;
  }

  const result = await tx(async (client) => {
    const challenge = (await client.query(
      `SELECT id,source_user_id,source_platform,target_platform,expires_at,status
         FROM account_link_challenges
        WHERE token_hash=$1
        FOR UPDATE`,
      [sha256(cleanToken)],
    )).rows[0];

    if (!challenge || challenge.status !== "pending" || new Date(challenge.expires_at).getTime() <= Date.now()) {
      throw Object.assign(new Error("لینک اتصال منقضی یا قبلاً استفاده شده است"), { status: 409, code: "link_expired" });
    }
    if (challenge.target_platform !== target || challenge.source_platform === target) {
      throw Object.assign(new Error("این لینک برای این پلتفرم صادر نشده است"), { status: 409, code: "link_platform_mismatch" });
    }
    if (Number(challenge.source_user_id) <= 0) {
      throw Object.assign(new Error("حساب مبدا معتبر نیست"), { status: 409, code: "link_source_invalid" });
    }

    const sourceUserId = Number(challenge.source_user_id);
    const existingTarget = (await client.query(
      `SELECT id,user_id,platform,platform_user_id FROM identities
        WHERE platform=$1 AND platform_user_id=$2
        FOR UPDATE`,
      [target, String(platformUserId)],
    )).rows[0] || null;

    if (existingTarget && Number(existingTarget.user_id) !== sourceUserId) {
      throw Object.assign(new Error("این حساب بله/تلگرام قبلاً به یک حساب جارچی دیگر متصل شده است"), { status: 409, code: "identity_already_linked" });
    }

    const sourceIdentity = (await client.query(
      `SELECT id,platform,platform_user_id FROM identities WHERE user_id=$1 AND platform=$2 LIMIT 1`,
      [sourceUserId, challenge.source_platform],
    )).rows[0] || null;
    if (!sourceIdentity) {
      throw Object.assign(new Error("حساب مبدا دیگر معتبر نیست؛ دوباره وارد مینی‌اپ شوید"), { status: 409, code: "source_identity_missing" });
    }

    const profileData = normalizeProfile(profile);
    if (existingTarget) {
      await client.query(
        `UPDATE identities SET username=$3,raw_profile=$4 WHERE id=$1 AND user_id=$2`,
        [existingTarget.id, sourceUserId, profileData.username, profileData.raw_profile],
      );
    } else {
      await client.query(
        `INSERT INTO identities(user_id,platform,platform_user_id,username,raw_profile)
         VALUES($1,$2,$3,$4,$5)`,
        [sourceUserId, target, String(platformUserId), profileData.username, profileData.raw_profile],
      );
    }

    await client.query(
      `UPDATE users SET display_name=CASE WHEN display_name='' THEN $2 ELSE display_name END,
                        last_seen_at=NOW(),updated_at=NOW()
        WHERE id=$1`,
      [sourceUserId, profileData.display_name],
    );

    // Keep operator access symmetric when the same Jarchi account is already a super/admin account.
    // Never overwrite another administrator's platform identity.
    if (challenge.source_platform === "telegram" && target === "bale") {
      const conflict = (await client.query(
        `SELECT id FROM admin_users WHERE bale_user_id=$1 AND telegram_user_id<>$2 LIMIT 1`,
        [String(platformUserId), sourceIdentity.platform_user_id],
      )).rows[0];
      if (conflict) {
        throw Object.assign(new Error("این شناسه بله قبلاً به یک مدیر دیگر متصل شده است"), { status: 409, code: "admin_identity_conflict" });
      }
      await client.query(
        `UPDATE admin_users SET bale_user_id=$2,updated_at=NOW()
          WHERE telegram_user_id=$1 AND (bale_user_id IS NULL OR bale_user_id='')`,
        [sourceIdentity.platform_user_id, String(platformUserId)],
      );
    } else if (challenge.source_platform === "bale" && target === "telegram") {
      const conflict = (await client.query(
        `SELECT id FROM admin_users WHERE telegram_user_id=$1 AND bale_user_id<>$2 LIMIT 1`,
        [String(platformUserId), sourceIdentity.platform_user_id],
      )).rows[0];
      if (conflict) {
        throw Object.assign(new Error("این شناسه تلگرام قبلاً به یک مدیر دیگر متصل شده است"), { status: 409, code: "admin_identity_conflict" });
      }
      await client.query(
        `UPDATE admin_users SET telegram_user_id=$2,updated_at=NOW()
          WHERE bale_user_id=$1 AND (telegram_user_id IS NULL OR telegram_user_id='')`,
        [sourceIdentity.platform_user_id, String(platformUserId)],
      );
    }

    await client.query(
      `UPDATE account_link_challenges
          SET status='completed',completed_at=NOW(),completed_platform_user_id=$2
        WHERE id=$1`,
      [challenge.id, String(platformUserId)],
    );

    return { userId: sourceUserId, sourcePlatform: challenge.source_platform, targetPlatform: target };
  });

  logger.info("account identities linked", {
    user_id: result.userId,
    source_platform: result.sourcePlatform,
    target_platform: result.targetPlatform,
  });
  return result;
}

export async function unlinkIdentity(userId, platform) {
  const target = platformValue(platform);
  const account = await getUnifiedAccount(userId);
  const linked = account.identities[target];
  if (!linked) return { unlinked: false, reason: "not_linked" };

  const identityCount = Object.values(account.identities).filter(Boolean).length;
  if (identityCount <= 1) {
    const error = new Error("آخرین روش ورود را نمی‌توان قطع کرد");
    error.status = 409;
    error.code = "last_identity";
    throw error;
  }

  await tx(async (client) => {
    await client.query("DELETE FROM identities WHERE user_id=$1 AND platform=$2", [Number(userId), target]);
    await client.query("UPDATE app_sessions SET revoked_at=NOW() WHERE user_id=$1 AND platform=$2 AND revoked_at IS NULL", [Number(userId), target]);
  });
  logger.info("account identity unlinked", { user_id: Number(userId), platform: target });
  return { unlinked: true, platform: target };
}

import { query } from "../db/db.js";
import { logger } from "../logger.js";

function hoursUntil(date) {
  return (new Date(date).getTime() - Date.now()) / 3600000;
}

async function notify(sendTelegram, row, phase, text) {
  if (!row.platform_user_id) return false;
  try {
    await sendTelegram(row.platform_user_id, text);
    return true;
  } catch (error) {
    // One bad/deleted/bot recipient must never abort expiry processing for every
    // subscription behind it. Warnings remain retryable on the next scan because
    // their notified_* timestamp is written only after a successful send.
    logger.warn("expiry notification failed", {
      subscription_id: row.id,
      user_id: row.user_id,
      phase,
      error: { name: error?.name || "Error", message: String(error?.message || error) },
    });
    return false;
  }
}

export async function scanExpiry(sendTelegram) {
  const rows = (await query(
    `SELECT s.*, i.platform_user_id
     FROM subscriptions s
     LEFT JOIN identities i
       ON i.user_id=s.user_id AND i.platform='telegram'
     WHERE s.status='active'
       AND s.expires_at <= NOW() + INTERVAL '4 days'
     ORDER BY s.expires_at ASC`,
  )).rows;

  const stats = { processed: rows.length, expired: 0, notified: 0, notification_failures: 0 };

  for (const row of rows) {
    const hours = hoursUntil(row.expires_at);

    if (hours <= 0) {
      let sent = false;
      if (!row.notified_expired_at && row.platform_user_id) {
        sent = await notify(
          sendTelegram,
          row,
          "expired",
          "⛔ اشتراک جارچی شما منقضی شده است.\nانتشار آگهی متوقف شده؛ برای تمدید وارد پنل کاربری شوید.",
        );
        if (sent) stats.notified += 1; else stats.notification_failures += 1;
      }

      // Expiry is business state, not a notification side effect. It must be
      // committed even when Telegram refuses a recipient.
      await query(
        `UPDATE subscriptions
         SET status='expired',
             notified_expired_at=CASE WHEN $2::boolean THEN COALESCE(notified_expired_at,NOW()) ELSE notified_expired_at END
         WHERE id=$1 AND status='active'`,
        [row.id, sent],
      );
      stats.expired += 1;
      continue;
    }

    if (row.platform_user_id && hours <= 24 && !row.notified_1d_at) {
      const sent = await notify(
        sendTelegram,
        row,
        "1d",
        "🚨 کمتر از ۱ روز تا پایان اشتراک جارچی شما باقی مانده است.\nبرای جلوگیری از توقف انتشار، اشتراک را تمدید کنید.",
      );
      if (sent) {
        stats.notified += 1;
        await query(
          "UPDATE subscriptions SET notified_1d_at=NOW() WHERE id=$1 AND notified_1d_at IS NULL",
          [row.id],
        );
      } else stats.notification_failures += 1;
      continue;
    }

    if (row.platform_user_id && hours <= 72 && !row.notified_3d_at) {
      const sent = await notify(
        sendTelegram,
        row,
        "3d",
        "⚠️ فقط ۳ روز تا پایان اشتراک جارچی شما باقی مانده است.\nبرای تمدید از پنل کاربری استفاده کنید.",
      );
      if (sent) {
        stats.notified += 1;
        await query(
          "UPDATE subscriptions SET notified_3d_at=NOW() WHERE id=$1 AND notified_3d_at IS NULL",
          [row.id],
        );
      } else stats.notification_failures += 1;
    }
  }
  return stats;
}

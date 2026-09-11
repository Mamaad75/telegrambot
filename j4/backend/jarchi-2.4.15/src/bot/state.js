import { query } from "../db/db.js";
import { config } from "../config.js";

/**
 * Persistent state for the Telegram admin bot's multi-step flows.
 *
 * 1.2.0 kept this in a module-level `Map()`: unbounded, per-process, and lost
 * on every restart — a half-finished "create client" flow simply stopped
 * responding. State now lives in `admin_bot_states` with:
 *   - one row per (admin telegram id, chat), so a flow cannot fork
 *   - an expiry, so an abandoned flow stops capturing the admin's messages
 *   - survival across restarts, with the step recorded explicitly
 */

const TTL_MINUTES = () => Math.max(1, config.botStateTtlMinutes);

export async function setState(telegramUserId, chatId, flow, step, data = {}) {
  const row = (await query(
    `INSERT INTO admin_bot_states(telegram_user_id,chat_id,flow,step,data,expires_at)
     VALUES($1,$2,$3,$4,$5::jsonb,NOW()+($6||' minutes')::interval)
     ON CONFLICT(telegram_user_id,chat_id) DO UPDATE SET
       flow=EXCLUDED.flow, step=EXCLUDED.step, data=EXCLUDED.data,
       expires_at=EXCLUDED.expires_at, updated_at=NOW()
     RETURNING id,flow,step,data,expires_at`,
    [String(telegramUserId), String(chatId), String(flow), String(step), JSON.stringify(data), String(TTL_MINUTES())],
  )).rows[0];
  return row;
}

/** Returns the live flow, or null when there is none or it has expired. */
export async function getState(telegramUserId, chatId) {
  const row = (await query(
    `SELECT id,flow,step,data,expires_at FROM admin_bot_states
      WHERE telegram_user_id=$1 AND chat_id=$2 AND expires_at > NOW()`,
    [String(telegramUserId), String(chatId)],
  )).rows[0];
  return row || null;
}

export async function advanceState(telegramUserId, chatId, step, data) {
  return (await query(
    `UPDATE admin_bot_states
        SET step=$3, data=$4::jsonb, expires_at=NOW()+($5||' minutes')::interval, updated_at=NOW()
      WHERE telegram_user_id=$1 AND chat_id=$2 AND expires_at > NOW()
      RETURNING id,flow,step,data,expires_at`,
    [String(telegramUserId), String(chatId), String(step), JSON.stringify(data || {}), String(TTL_MINUTES())],
  )).rows[0] || null;
}

export async function clearState(telegramUserId, chatId) {
  const result = await query(
    "DELETE FROM admin_bot_states WHERE telegram_user_id=$1 AND chat_id=$2",
    [String(telegramUserId), String(chatId)],
  );
  return result.rowCount > 0;
}

/** Housekeeping for states whose owner never finished or cancelled. */
export async function purgeExpiredStates() {
  const result = await query("DELETE FROM admin_bot_states WHERE expires_at < NOW()");
  return result.rowCount;
}

import { config } from "../config.js";
import { can, PERMISSIONS } from "../core/rbac.js";
import { findAdminByTelegramId } from "../services/adminUsers.js";
import { recordAudit } from "../services/audit.js";
import { consume } from "../middleware/rateLimit.js";
import { logger } from "../logger.js";

/**
 * Telegram admin authorization.
 *
 * Every command and every callback resolves the actor from the *Telegram user
 * id on the update* and looks them up in `admin_users`. Callback data is never
 * trusted to carry identity or entitlement: it only names an action, and the
 * permission for that action is checked here, server-side, on each press.
 *
 * ADMIN_TELEGRAM_ID alone is no longer the security model — it is only used
 * once at boot to seed the first super admin (see ensureBootstrapAdmin).
 */

export async function resolveAdminActor(update) {
  const telegramUserId = String(update?.from?.id || "");
  if (!telegramUserId) return null;

  const admin = await findAdminByTelegramId(telegramUserId);
  if (!admin || admin.status !== "active") return null;
  return { ...admin, channel: "telegram", telegram_user_id: telegramUserId };
}

/** Per-admin flood control for bot interactions. */
export function checkBotRateLimit(telegramUserId) {
  if (!config.rateLimit.enabled) return { allowed: true };
  return consume("bot-admin", String(telegramUserId), {
    windowMs: config.rateLimit.botWindowMs,
    max: config.rateLimit.botMax,
  });
}

/**
 * Authorizes one admin action. Returns the actor on success, or a reason code
 * the caller turns into an answerCallbackQuery/message.
 */
export async function authorize(update, permission, { action = "", requestId = "" } = {}) {
  const telegramUserId = String(update?.from?.id || "");
  const actor = await resolveAdminActor(update);

  if (!actor) {
    logger.warn("unauthorized telegram admin attempt", { telegram_user_id: telegramUserId, action });
    await recordAudit({
      actor: { username: `telegram:${telegramUserId}`, role: "" },
      action: action || "bot.action", targetType: "telegram_user", targetId: telegramUserId,
      success: false, channel: "telegram", requestId, metadata: { reason: "not_an_admin", permission },
    });
    return { ok: false, reason: "not_admin", message: "⛔ دسترسی ندارید." };
  }

  const limit = checkBotRateLimit(telegramUserId);
  if (!limit.allowed) {
    return { ok: false, reason: "rate_limited", actor, message: "⏳ تعداد درخواست‌ها زیاد است؛ چند لحظه صبر کنید." };
  }

  if (permission && !can(actor, permission)) {
    await recordAudit({
      actor, action: "authorization.denied", targetType: "permission", targetId: permission,
      success: false, channel: "telegram", requestId, metadata: { bot_action: action },
    });
    return { ok: false, reason: "forbidden", actor, message: "⛔ این عملیات در سطح دسترسی شما نیست." };
  }

  return { ok: true, actor };
}

/** Convenience wrapper used by admin bot handlers to audit what they did. */
export async function auditBot(actor, action, { targetType = "", targetId = "", success = true, metadata = {} } = {}) {
  await recordAudit({ actor, action, targetType, targetId, success, channel: "telegram", metadata });
}

export { PERMISSIONS };

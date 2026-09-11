import { authenticateCustomer } from "./customerAuth.js";
import { query } from "../db/db.js";
import { permissionsForRole } from "../core/rbac.js";
import { safeEqual } from "../utils/security.js";

export async function miniAppAdminAuth(req, res, next) {
  try {
    const resolved = await authenticateCustomer(req);
    if (!resolved) return res.status(401).json({ success: false, error: "Authentication required" });
    req.user = resolved.user;
    req.authPlatform = resolved.platform;

    const platform = String(req.authPlatform || "").toLowerCase();
    const identity = (await query(
      `SELECT platform, platform_user_id FROM identities WHERE user_id=$1 AND platform=$2 LIMIT 1`,
      [req.user.id, platform],
    )).rows[0];
    if (!identity) return res.status(403).json({ success: false, error: "Admin identity not linked" });

    const column = platform === "bale" ? "bale_user_id" : platform === "telegram" ? "telegram_user_id" : null;
    if (!column) return res.status(403).json({ success: false, error: "Admin Mini App requires Telegram or Bale" });

    const admin = (await query(
      `SELECT id,username,display_name,role,status,telegram_user_id,bale_user_id,last_login_at,locked_until,failed_attempts,created_at,updated_at
         FROM admin_users WHERE ${column}=$1 AND status='active' LIMIT 1`,
      [String(identity.platform_user_id)],
    )).rows[0];
    if (!admin) return res.status(403).json({ success: false, error: "شما دسترسی مدیریت ندارید." });

    req.miniAppAdmin = true;
    req.admin = {
      id: Number(admin.id),
      username: admin.username,
      display_name: admin.display_name,
      role: admin.role,
      status: admin.status,
      telegram_user_id: admin.telegram_user_id || null,
      bale_user_id: admin.bale_user_id || null,
      permissions: permissionsForRole(admin.role),
      channel: platform === "bale" ? "bale_mini_app" : "telegram_mini_app",
    };
    req.adminAuthMethod = req.admin.channel;
    return next();
  } catch (error) {
    if (res.headersSent) return undefined;
    return res.status(401).json({ success: false, error: error.message || "Authentication required" });
  }
}

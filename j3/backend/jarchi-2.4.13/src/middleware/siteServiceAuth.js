import { getSite } from "../services/clients.js";
import { config } from "../config.js";
import { query } from "../db/db.js";
import { ensureTrial } from "../services/billing.js";
import { safeEqual } from "../utils/security.js";

/**
 * Machine authentication for first-party WordPress/plugin integrations.
 *
 * The plugin already possesses the site's webhook secret. Reusing that secret
 * avoids creating a second credential while keeping customer bearer sessions
 * separate. This middleware never accepts a user id from the request.
 */
export async function siteServiceAuth(req, res, next) {
  try {
    const siteId = String(req.params.siteId || "").trim();
    if (!siteId) return res.status(400).json({ success: false, error: "siteId is required" });

    const site = await getSite(siteId);
    if (!site || !site.enabled) {
      return res.status(403).json({ success: false, error: "Unknown or disabled site" });
    }

    const supplied = String(req.get("X-Webhook-Secret") || req.get("X-API-Key") || "").trim();
    if (!site.webhook_secret || !safeEqual(supplied, site.webhook_secret)) {
      return res.status(401).json({ success: false, error: "Invalid site authentication" });
    }

    if (!site.owner_user_id) {
      return res.status(409).json({ success: false, error: "Site owner is not configured" });
    }

    const user = (await query("SELECT id, display_name, username, phone, status FROM users WHERE id=$1", [Number(site.owner_user_id)])).rows[0] || null;
    if (!user || user.status !== "active") {
      return res.status(403).json({ success: false, error: "Site owner is inactive" });
    }

    if (config.autoTrialOnStart) await ensureTrial(user.id);
    req.site = site;
    req.user = user;
    req.authPlatform = "wordpress_plugin";
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}

import { requireOwnedSite } from "./customerAuth.js";

export const SITE_ROLES = Object.freeze(["owner", "admin", "support"]);

export function requireSiteRole(roles = SITE_ROLES) {
  const allowed = new Set(Array.isArray(roles) ? roles : [roles]);
  return async (req, res, next) => {
    try {
      const siteId = String(req.params?.siteId || req.body?.site_id || req.query?.site_id || "").trim();
      if (!siteId) return res.status(400).json({ success: false, error: "site_id is required" });
      const site = await requireOwnedSite(req, res, siteId);
      if (!site) return undefined;
      if (!allowed.has(String(req.siteRole))) {
        return res.status(403).json({ success: false, error: "دسترسی شما برای این عملیات کافی نیست", error_code: "site_role_forbidden" });
      }
      req.site = site;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const requireOwnerAdmin = requireSiteRole(["owner", "admin"]);
export const requireOwnerAdminSupport = requireSiteRole(["owner", "admin", "support"]);

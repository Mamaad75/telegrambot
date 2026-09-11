import { requireFeature, requireFeatureForSite } from "../services/entitlements.js";
import { requireOwnedSite } from "./customerAuth.js";

function siteIdFromRequest(req) {
  return String(req.params?.siteId || req.body?.site_id || req.query?.site_id || "").trim();
}

export const requireRemoteFeature = (feature) => async (req, res, next) => {
  try {
    req.jarchiSubscription = await requireFeature(req.user?.id, feature);
    return next();
  } catch (error) {
    return res.status(error.status || 403).json({ success: false, error: error.code || "forbidden", message: error.message, feature: error.feature || feature, plan_required: true });
  }
};

export const requireRemoteFeatureForSite = (feature, { roles = null } = {}) => async (req, res, next) => {
  try {
    const siteId = siteIdFromRequest(req);
    if (!siteId) return res.status(400).json({ success: false, error: "site_id is required" });

    // Prove site access first. This prevents leaking entitlement state for sites the caller cannot see.
    const site = await requireOwnedSite(req, res, siteId);
    if (!site) return undefined;
    if (roles && !roles.includes(String(req.siteRole))) {
      return res.status(403).json({ success: false, error: "دسترسی شما برای این عملیات کافی نیست", error_code: "site_role_forbidden" });
    }
    req.site = site;
    req.jarchiSiteId = siteId;
    req.jarchiSubscription = await requireFeatureForSite(req.user?.id, siteId, feature);
    return next();
  } catch (error) {
    return res.status(error.status || 403).json({ success: false, error: error.code || "forbidden", message: error.message, feature: error.feature || feature, site_id: siteIdFromRequest(req) || null, plan_required: true });
  }
};

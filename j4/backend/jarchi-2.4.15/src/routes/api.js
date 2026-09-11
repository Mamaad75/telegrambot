import express from "express";
import { config } from "../config.js";
import { query } from "../db/db.js";
import { saveConnection } from "../services/users.js";
import { currentSubscription, getPlans } from "../services/billing.js";
import { requestZarinPal } from "../services/zarinpal.js";
import { savePreference } from "../services/preferences.js";
import { getSite } from "../services/clients.js";
import { listFieldCatalog, setFieldOverride, reorderFields } from "../services/fields.js";
import { recommendFieldPreset } from "../core/fieldPreset.js";
import * as siteMembers from "../services/siteMembers.js";
import { apiRateLimit } from "../middleware/rateLimit.js";
import { handler, errorMiddleware } from "../middleware/respond.js";
import { requirePlatform, optionalPhone, requireString } from "../middleware/validate.js";
import { customerAuth as auth } from "../middleware/customerAuth.js";
import { getEntitlements } from "../services/entitlements.js";
import { requireOwnedSite } from "../middleware/customerAuth.js";
import { createAnnouncement } from "../services/wordpressContent.js";
import { requireRemoteFeatureForSite } from "../middleware/siteEntitlement.js";

/**
 * Customer API used by the Telegram Mini App.
 *
 * Response shapes are unchanged from 1.2.0 — public/app/app.js and any deployed
 * Mini App build depend on them.
 */
export const api = express.Router();

api.use(apiRateLimit());

api.get("/health", (req, res) => res.json({ success: true, service: "jarchi", version: config.version }));

api.get("/plans", handler(async (req, res) => res.json({ success: true, plans: await getPlans(), payment_url: config.paymentUrl || "" })));

// Exchange the bot-launch token for the first-party HttpOnly session cookie.
// This is the preferred Mini App bootstrap path because the token stays out of
// the query string after the initial page load. Legacy ?session= remains accepted
// for existing callers.
api.post("/session/exchange", auth, handler(async (req, res) => {
  return res.json({ success: true, user_id: req.user.id, platform: req.authPlatform });
}));

api.get("/me", auth, handler(async (req, res) => {
  const subscription = await currentSubscription(req.user.id);
  res.json({
    success: true,
    // A customer sees their own phone; nothing here exposes another party's.
    user: {
      id: req.user.id,
      display_name: req.user.display_name,
      username: req.user.username,
      phone: req.user.phone,
    },
    subscription,
    entitlements: await getEntitlements(req.user.id, req.query?.site_id || ""),
  });
}));

api.get("/sites", auth, handler(async (req, res) => {
  const result = await query(
    `SELECT s.id,s.name,s.wordpress_url,s.telegram_channel_id,s.bale_chat_id,s.enabled,
            s.last_publication_at,s.last_webhook_at,
            CASE WHEN s.owner_user_id=$1 THEN 'owner' ELSE COALESCE(m.role,'') END AS site_role
       FROM sites s
       LEFT JOIN site_members m ON m.site_id=s.id AND m.user_id=$1 AND m.status='active'
      WHERE s.owner_user_id=$1 OR m.user_id=$1
      ORDER BY s.created_at DESC`,
    [req.user.id],
  );
  const sites = await Promise.all(result.rows.map(async (row) => {
    const entitlements = await getEntitlements(req.user.id, row.id);
    return { ...row, entitlements, remote_access: entitlements.features.site_control };
  }));
  res.json({ success: true, sites });
}));

api.post("/sites/:siteId/announcements", auth, requireRemoteFeatureForSite("remote_announcements", { roles: ["owner", "admin"] }), handler(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId);
  if (!site) return undefined;
  const title = String(req.body?.title || "").trim();
  const content = String(req.body?.content || "").trim();
  if (!title || !content) return res.status(400).json({ success:false, error:"title and content are required" });
  const result = await createAnnouncement(site, {
    title: title.slice(0, 190),
    content: content.slice(0, 10000),
    placement: String(req.body?.placement || "page"),
    homepage: Boolean(req.body?.homepage),
  });
  res.status(201).json({ success:true, announcement:result });
}));

/* ------------------------------ site members ------------------------------ */

/*
 * Team management for a customer's own site.
 *
 * Authority comes from the same place the rest of the customer API uses —
 * requireOwnedSite sets req.siteRole from sites.owner_user_id or site_members —
 * so there is no second ownership model here. Support is deliberately excluded
 * from every write: a support member works the site's tickets and publications
 * but must not be able to grant themselves an admin, or remove the people above
 * them.
 */
async function memberScope(req, res, { write = false } = {}) {
  const site = await requireOwnedSite(req, res, req.params.siteId);
  if (!site) return null;
  if (write && !siteMembers.canManageMembers(req.siteRole)) {
    res.status(403).json({
      success: false,
      error: "فقط مالک سایت یا مدیر سایت می‌تواند اعضا را تغییر دهد",
      error_code: "member_management_forbidden",
    });
    return null;
  }
  return site;
}

/** Turns a MemberError into the customer API's response shape. */
const memberRoute = (run) => handler(async (req, res) => {
  try {
    return await run(req, res);
  } catch (error) {
    if (error instanceof siteMembers.MemberError) {
      return res.status(error.status).json({ success: false, error: error.message, error_code: error.code });
    }
    throw error;
  }
});

api.get("/sites/:siteId/members", auth, memberRoute(async (req, res) => {
  const site = await memberScope(req, res);
  if (!site) return undefined;
  const result = await siteMembers.listMembers(site.id);
  return res.json({
    success: true,
    ...result,
    site_role: req.siteRole,
    can_manage: siteMembers.canManageMembers(req.siteRole),
  });
}));

/**
 * Adds a member by the id the customer knows them by. The person must already
 * have opened the bot; findUserByPlatformId says so explicitly rather than
 * creating a placeholder account for an id nobody has claimed.
 */
api.post("/sites/:siteId/members", auth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), memberRoute(async (req, res) => {
  const site = await memberScope(req, res, { write: true });
  if (!site) return undefined;
  const member = await siteMembers.addMember(site.id, {
    platform: req.body?.platform || req.authPlatform || "telegram",
    platform_user_id: req.body?.platform_user_id,
    role: req.body?.role || "support",
    actor: `user:${req.user.id}`,
  });
  return res.status(201).json({ success: true, site_id: site.id, member });
}));

api.patch("/sites/:siteId/members/:userId", auth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), memberRoute(async (req, res) => {
  const site = await memberScope(req, res, { write: true });
  if (!site) return undefined;
  const member = await siteMembers.setMemberRole(site.id, req.params.userId, req.body?.role, {
    actor: `user:${req.user.id}`,
  });
  return res.json({ success: true, site_id: site.id, member });
}));

api.delete("/sites/:siteId/members/:userId", auth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), memberRoute(async (req, res) => {
  const site = await memberScope(req, res, { write: true });
  if (!site) return undefined;
  // Removing yourself would leave a site with nobody able to manage it if the
  // last admin did it, and is never what the button in front of them means.
  if (String(req.params.userId) === String(req.user.id)) {
    return res.status(409).json({
      success: false, error: "نمی‌توانید دسترسی خودتان را حذف کنید", error_code: "cannot_remove_self",
    });
  }
  return res.json({ success: true, ...(await siteMembers.removeMember(site.id, req.params.userId, { actor: `user:${req.user.id}` })) });
}));

/** Who a platform id belongs to, before the customer commits to adding them. */
api.get("/sites/:siteId/member-lookup/:platform/:platformUserId", auth, memberRoute(async (req, res) => {
  const site = await memberScope(req, res, { write: true });
  if (!site) return undefined;
  const user = await siteMembers.findUserByPlatformId(req.params.platform, req.params.platformUserId);
  return res.json({
    success: true,
    user: {
      id: Number(user.id),
      display_name: user.display_name,
      username: user.username,
      platform: user.platform,
      platform_user_id: user.platform_user_id,
    },
  });
}));

api.get("/entitlements/:siteId", auth, handler(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId);
  if (!site) return undefined;
  res.json({ success: true, entitlements: await getEntitlements(req.user.id, site.id) });
}));

api.get("/fields/:siteId", auth, handler(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId);
  if (!site) return undefined;
  const fields = await listFieldCatalog(site.id);
  res.json({
    success: true,
    fields: fields.map((field) => ({
      field_key: field.field_key,
      label: field.label,
      field_order: field.field_order,
      field_type: field.field_type,
      visibility: field.visibility,
      field_meta: field.field_meta,
      platforms: field.platforms,
      label_override: field.label_override,
      order_override: field.order_override,
      platform_overrides: field.platform_overrides,
      hidden: field.hidden,
      effective_label: field.effective_label,
      effective_order: field.effective_order,
      effective_platforms: field.effective_platforms,
      has_override: field.has_override,
    })),
  });
}));

/*
 * Publication fields, writable by the people who own the site.
 *
 * Reading has always been here. Writing was not: the Mini App's field controls
 * called /api/admin-mini/clients/:id/fields, which is the Jarchi *operator*
 * route behind the platform RBAC. A site owner who is not also a Jarchi
 * operator therefore saw editable controls that answered 403 — the screen
 * offered an edit it could not perform.
 *
 * These write through setFieldOverride, which is the same column the publication
 * formatter reads. There is no second copy of this configuration: changing a
 * toggle here changes what the next Telegram and Bale message contains.
 */
api.patch("/fields/:siteId/:fieldKey", auth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), handler(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId, { roles: ["owner", "admin"] });
  if (!site) return undefined;

  const body = req.body || {};
  const patch = {};

  if (body.platforms !== undefined) {
    if (typeof body.platforms !== "object" || body.platforms === null || Array.isArray(body.platforms)) {
      return res.status(400).json({ success: false, error: "platforms must be an object" });
    }
    patch.platform_overrides = body.platforms;
  }
  if (body.hidden !== undefined) patch.hidden = Boolean(body.hidden);
  if (body.label_override !== undefined) {
    patch.label_override = body.label_override === null ? null : String(body.label_override);
  }
  if (body.order_override !== undefined) {
    patch.order_override = body.order_override === null ? null : Number(body.order_override);
  }

  if (!Object.keys(patch).length) {
    return res.status(400).json({ success: false, error: "nothing to change" });
  }

  const field = await setFieldOverride(site.id, req.params.fieldKey, patch, { actor: `user:${req.user.id}` });

  if (!field) {
    // The key is not in this site's catalog. Not a permission answer: from this
    // site's point of view the field does not exist.
    return res.status(404).json({ success: false, error: "Field not found", error_code: "field_not_found" });
  }

  return res.json({ success: true, field });
}));

/* The reorder control on the same screen, for the same two kinds of person. */
api.post("/fields/:siteId/reorder", auth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), handler(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId, { roles: ["owner", "admin"] });
  if (!site) return undefined;

  const order = Array.isArray(req.body?.order) ? req.body.order : null;

  if (!order) return res.status(400).json({ success: false, error: "order must be an array" });

  // Keys that are not in this site's catalog are ignored by the service rather
  // than inserted, so a stale list cannot create fields.
  const updated = await reorderFields(site.id, order, { actor: `user:${req.user.id}` });

  return res.json({ success: true, updated });
}));

/*
 * "Jarchi Recommended".
 *
 * A site arrives with every discovered field and no opinion about which of them
 * belong in a message, and reaching a sensible answer by hand means a decision
 * per field. This applies one.
 *
 * Three properties, all deliberate:
 *
 *  - It is explicit. Nothing here runs on upgrade, on first login, or as a
 *    side effect of opening the screen. A preset that applied itself would be
 *    indistinguishable from the plugin overriding the operator.
 *  - It writes through the same override layer as the individual toggles, so
 *    afterwards every field is editable exactly as before.
 *  - It reports what it changed, so the screen can say so.
 */
api.post("/fields/:siteId/preset", auth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), handler(async (req, res) => {
  const site = await requireOwnedSite(req, res, req.params.siteId, { roles: ["owner", "admin"] });
  if (!site) return undefined;

  const name = String(req.body?.preset || "jarchi_recommended");

  if (name !== "jarchi_recommended") {
    return res.status(400).json({ success: false, error: "Unknown preset", error_code: "unknown_preset" });
  }

  const catalog = await listFieldCatalog(site.id);
  const plan = recommendFieldPreset(catalog);

  for (const item of plan.apply) {
    await setFieldOverride(site.id, item.field_key, {
      hidden: item.hidden,
      platform_overrides: item.platforms,
      order_override: item.order,
    }, { actor: `user:${req.user.id}` });
  }

  return res.json({
    success: true,
    preset: name,
    applied: plan.apply.length,
    enabled: plan.enabled,
    hidden: plan.hiddenKeys,
    fields: await listFieldCatalog(site.id),
  });
}));

api.put("/preferences", auth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), handler(async (req, res) => {
  const { site_id: siteId, platform, enabled, field_keys: fieldKeys } = req.body || {};
  requirePlatform(platform);

  const site = await requireOwnedSite(req, res, siteId);
  if (!site) return undefined;
  if (fieldKeys !== undefined && !Array.isArray(fieldKeys)) {
    return res.status(400).json({ success: false, error: "field_keys must be an array" });
  }

  const preference = await savePreference(req.user.id, siteId, platform, enabled !== false, fieldKeys);
  res.json({ success: true, preference });
}));

api.post("/connections/whatsapp", auth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), handler(async (req, res) => {
  const { name = "whatsapp", accessToken, phoneNumberId, site_id: siteId } = req.body || {};
  if (!accessToken || !phoneNumberId || !siteId) {
    return res.status(400).json({ success: false, error: "accessToken, phoneNumberId and site_id are required" });
  }
  const connection = await saveConnection(
    req.user.id, "whatsapp", String(name).slice(0, 64),
    { accessToken, phoneNumberId }, { phoneNumberId }, config.credentialKey,
  );
  res.json({ success: true, connection });
}));

api.post("/connections/bale", auth, requireRemoteFeatureForSite("site_control", { roles: ["owner", "admin"] }), handler(async (req, res) => {
  const { name = "bale", token, chat_id: chatId, site_id: siteId } = req.body || {};
  if (!token || !chatId) return res.status(400).json({ success: false, error: "token and chat_id are required" });
  if (!siteId) return res.status(400).json({ success: false, error: "site_id is required" });
  const connection = await saveConnection(
    req.user.id, "bale", String(name).slice(0, 64),
    { token }, { chat_id: chatId }, config.credentialKey,
  );
  res.json({ success: true, connection });
}));

api.post("/billing/zarinpal", auth, handler(async (req, res) => {
  try {
    const planId = requireString(req.body?.plan_id, "plan_id", { max: 32 });
    res.json({ success: true, ...await requestZarinPal(req.user.id, planId) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
}));

api.use(errorMiddleware);

import express from "express";
import { ok, handler, notFound, badRequest } from "../../middleware/respond.js";
import { requirePermission } from "../../middleware/adminAuth.js";
import { PERMISSIONS } from "../../core/rbac.js";
import { recordAudit } from "../../services/audit.js";
import {
  listSubscriptions, getSubscription, extendSubscription, expireSubscription, cancelSubscription,
  grantSubscription, listPlans, createPlan, updatePlan, deletePlan, listInvoices, getInvoice,
  PLAN_FEATURES,
} from "../../services/billing.js";
import { requireInt, requireString, optionalInt, optionalBoolean } from "../../middleware/validate.js";

export const subscriptionRoutes = express.Router();
export const planRoutes = express.Router();
export const invoiceRoutes = express.Router();

/* ------------------------------ subscriptions ------------------------------ */

subscriptionRoutes.get("/", requirePermission(PERMISSIONS.SUBSCRIPTIONS_VIEW), handler(async (req, res) => {
  return ok(res, await listSubscriptions(req.query));
}));

subscriptionRoutes.get("/:id", requirePermission(PERMISSIONS.SUBSCRIPTIONS_VIEW), handler(async (req, res) => {
  const subscription = await getSubscription(requireInt(req.params.id, "id", { min: 1 }));
  if (!subscription) throw notFound("اشتراک یافت نشد");
  return ok(res, { subscription });
}));

subscriptionRoutes.post("/:id/extend", requirePermission(PERMISSIONS.SUBSCRIPTIONS_MANAGE), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const days = requireInt(req.body?.days, "days", { min: 1, max: 3650 });
  const subscription = await extendSubscription(id, days);
  if (!subscription) throw notFound("اشتراک یافت نشد");

  await recordAudit({
    actor: req.admin, action: "subscription.extend", targetType: "subscription", targetId: id,
    requestId: req.requestId, ip: req.ip, channel: "web",
    metadata: { days, expires_at: subscription.expires_at, reason: String(req.body?.reason || "").slice(0, 200) },
  });
  return ok(res, { subscription });
}));

subscriptionRoutes.post("/:id/expire", requirePermission(PERMISSIONS.SUBSCRIPTIONS_MANAGE), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const subscription = await expireSubscription(id);
  if (!subscription) throw notFound("اشتراک یافت نشد");
  await recordAudit({
    actor: req.admin, action: "subscription.expire", targetType: "subscription", targetId: id,
    requestId: req.requestId, ip: req.ip, channel: "web",
  });
  return ok(res, { subscription });
}));

subscriptionRoutes.post("/:id/cancel", requirePermission(PERMISSIONS.SUBSCRIPTIONS_MANAGE), handler(async (req, res) => {
  const id = requireInt(req.params.id, "id", { min: 1 });
  const subscription = await cancelSubscription(id);
  if (!subscription) throw notFound("اشتراک یافت نشد");
  await recordAudit({
    actor: req.admin, action: "subscription.cancel", targetType: "subscription", targetId: id,
    requestId: req.requestId, ip: req.ip, channel: "web",
  });
  return ok(res, { subscription });
}));

/** Grants a plan without payment; recorded with source='admin'. */
subscriptionRoutes.post("/grant", requirePermission(PERMISSIONS.SUBSCRIPTIONS_MANAGE), handler(async (req, res) => {
  const userId = requireInt(req.body?.user_id, "user_id", { min: 1 });
  const planId = requireString(req.body?.plan_id, "plan_id", { max: 32 });
  const days = optionalInt(req.body?.days, "days", { min: 1, max: 3650 });
  const replaceActive = req.body?.replace_active !== false;
  const reason = String(req.body?.reason || "").trim().slice(0, 240);

  const subscription = await grantSubscription(userId, planId, { days: days ?? null, replaceActive });
  await recordAudit({
    actor: req.admin, action: "subscription.grant", targetType: "user", targetId: userId,
    requestId: req.requestId, ip: req.ip, channel: "web",
    metadata: { plan_id: planId, days: days ?? null, replace_active: replaceActive, reason, subscription_id: subscription.id },
  });
  return ok(res, { subscription }, 201);
}));

/* --------------------------------- plans --------------------------------- */

/**
 * Plan entitlement flags.
 *
 * Rejecting an unknown key rather than dropping it is deliberate: a typo in a
 * flag name would otherwise look like it saved and quietly grant nothing.
 */
function requireFeatures(value, field = "features") {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw badRequest(`${field} must be an object`);
  const features = {};
  for (const [key, flag] of Object.entries(value)) {
    if (!PLAN_FEATURES.includes(key)) throw badRequest(`${field}.${key} is not a known capability`);
    if (typeof flag !== "boolean") throw badRequest(`${field}.${key} must be true or false`);
    features[key] = flag;
  }
  return features;
}

planRoutes.get("/", requirePermission(PERMISSIONS.PLANS_VIEW), handler(async (req, res) => {
  return ok(res, { plans: await listPlans({ includeInactive: req.query.include_inactive === "true" }) });
}));

planRoutes.post("/", requirePermission(PERMISSIONS.PLANS_MANAGE), handler(async (req, res) => {
  const plan = await createPlan({
    id: requireString(req.body?.id, "id", { max: 32 }),
    name: requireString(req.body?.name, "name", { max: 120 }),
    duration_days: requireInt(req.body?.duration_days, "duration_days", { min: 1, max: 3650 }),
    price_toman: requireInt(req.body?.price_toman ?? 0, "price_toman", { min: 0 }),
    telegram_stars: requireInt(req.body?.telegram_stars ?? 0, "telegram_stars", { min: 0 }),
    is_trial: optionalBoolean(req.body?.is_trial, "is_trial") ?? false,
    active: optionalBoolean(req.body?.active, "active") ?? true,
    features: requireFeatures(req.body?.features),
  });
  await recordAudit({
    actor: req.admin, action: "plan.create", targetType: "plan", targetId: plan.id,
    requestId: req.requestId, ip: req.ip, channel: "web", metadata: { name: plan.name },
  });
  return ok(res, { plan }, 201);
}));

/**
 * Plan edits apply to future purchases; issued invoices keep their amount, so
 * historical billing is never rewritten from here.
 */
planRoutes.patch("/:id", requirePermission(PERMISSIONS.PLANS_MANAGE), handler(async (req, res) => {
  const patch = {};
  if (req.body?.name !== undefined) patch.name = requireString(req.body.name, "name", { max: 120 });
  if (req.body?.duration_days !== undefined) patch.duration_days = requireInt(req.body.duration_days, "duration_days", { min: 1, max: 3650 });
  if (req.body?.price_toman !== undefined) patch.price_toman = requireInt(req.body.price_toman, "price_toman", { min: 0 });
  if (req.body?.telegram_stars !== undefined) patch.telegram_stars = requireInt(req.body.telegram_stars, "telegram_stars", { min: 0 });
  if (req.body?.is_trial !== undefined) patch.is_trial = optionalBoolean(req.body.is_trial, "is_trial");
  if (req.body?.active !== undefined) patch.active = optionalBoolean(req.body.active, "active");
  if (req.body?.features !== undefined) patch.features = requireFeatures(req.body.features);
  if (!Object.keys(patch).length) throw badRequest("No supported fields to update");

  const plan = await updatePlan(req.params.id, patch);
  if (!plan) throw notFound("پلن یافت نشد");
  await recordAudit({
    actor: req.admin, action: "plan.update", targetType: "plan", targetId: plan.id,
    requestId: req.requestId, ip: req.ip, channel: "web", metadata: { fields: Object.keys(patch) },
  });
  return ok(res, { plan });
}));

/**
 * Deleting a plan is refused while anyone is still on it or has ever been
 * billed for it. The refusal names the reason so the panel can offer the right
 * alternative (deactivate) instead of just reporting a failure.
 */
planRoutes.delete("/:id", requirePermission(PERMISSIONS.PLANS_MANAGE), handler(async (req, res) => {
  const result = await deletePlan(req.params.id);
  if (!result.deleted && result.reason === "not_found") throw notFound("پلن یافت نشد");
  if (!result.deleted) {
    await recordAudit({
      actor: req.admin, action: "plan.delete", targetType: "plan", targetId: req.params.id,
      success: false, requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
      metadata: { reason: result.reason },
    });
    const reasons = {
      trial_plan: "پلن آزمایشی برای ثبت‌نام کاربران تازه لازم است و حذف نمی‌شود. برای کنار گذاشتن آن، غیرفعالش کنید.",
      active_subscriptions: `این پلن ${result.active_subscriptions} اشتراک فعال دارد. به جای حذف، آن را غیرفعال کنید.`,
      has_invoices: `این پلن ${result.invoices} فاکتور ثبت‌شده دارد. به جای حذف، آن را غیرفعال کنید.`,
    };
    return res.status(409).json({
      success: false,
      error: reasons[result.reason] || "این پلن قابل حذف نیست.",
      error_code: result.reason,
      active_subscriptions: result.active_subscriptions ?? 0,
      invoices: result.invoices ?? 0,
    });
  }

  await recordAudit({
    actor: req.admin, action: "plan.delete", targetType: "plan", targetId: req.params.id,
    requestId: req.requestId, ip: req.ip, channel: req.adminAuthMethod || "web",
    metadata: { name: result.plan?.name || "" },
  });
  return ok(res, { deleted: true, plan_id: req.params.id });
}));

/* -------------------------------- invoices -------------------------------- */

invoiceRoutes.get("/", requirePermission(PERMISSIONS.INVOICES_VIEW), handler(async (req, res) => {
  return ok(res, await listInvoices(req.query));
}));

invoiceRoutes.get("/:id", requirePermission(PERMISSIONS.INVOICES_VIEW), handler(async (req, res) => {
  const invoice = await getInvoice(req.params.id);
  if (!invoice) throw notFound("فاکتور یافت نشد");
  return ok(res, { invoice });
}));

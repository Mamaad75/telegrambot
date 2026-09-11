import { query } from "../db/db.js";

export const REMOTE_FEATURES = Object.freeze({
  site_control: "site_control",
  remote_tickets: "remote_tickets",
  remote_announcements: "remote_announcements",
  remote_products: "remote_products",
  analytics: "analytics",
});

/** Return the user's own active paid subscription, never a trial. */
export async function activePaidSubscription(userId) {
  return (await query(
    `SELECT s.id,s.user_id,s.plan_id,s.starts_at,s.expires_at,s.status,p.name AS plan_name,p.is_trial,p.features
       FROM subscriptions s JOIN plans p ON p.id=s.plan_id
      WHERE s.user_id=$1
        AND s.status='active'
        AND s.expires_at>NOW()
        AND p.active=true
        AND p.is_trial=false
      ORDER BY s.expires_at DESC LIMIT 1`,
    [Number(userId)],
  )).rows[0] || null;
}

/**
 * Resolve the effective paid subscription for a user on a site. The site's
 * owner is the billing authority: active site members inherit the owner's
 * paid Mini App plan. The user's own active paid plan always wins.
 */
export async function activePaidSubscriptionForSite(userId, siteId) {
  const own = await activePaidSubscription(userId);
  if (own) return { ...own, grant_source: "user" };

  const id = String(siteId || "").trim();
  if (!id) return null;

  const row = (await query(
    `SELECT owner_sub.id,owner_sub.user_id,owner_sub.plan_id,owner_sub.starts_at,owner_sub.expires_at,owner_sub.status,
            p.name AS plan_name,p.is_trial,p.features,
            s.owner_user_id AS owner_user_id, m.role AS member_role
       FROM sites s
       JOIN site_members m ON m.site_id=s.id AND m.user_id=$1 AND m.status='active'
       JOIN LATERAL (
         SELECT ss.* FROM subscriptions ss
         JOIN plans pp ON pp.id=ss.plan_id
          WHERE ss.user_id=s.owner_user_id
            AND ss.status='active'
            AND ss.expires_at>NOW()
            AND pp.active=true
            AND pp.is_trial=false
          ORDER BY ss.expires_at DESC LIMIT 1
       ) owner_sub ON true
       JOIN plans p ON p.id=owner_sub.plan_id
      WHERE s.id=$2`,
    [Number(userId), id],
  )).rows[0];

  return row ? { ...row, grant_source: "site_owner" } : null;
}

export function featureEnabled(subscription, feature) {
  if (!subscription || subscription.is_trial) return false;
  const features = subscription.features && typeof subscription.features === "object" ? subscription.features : {};
  return features[feature] === true || features["* "] === true || features["*"] === true;
}

export async function getEntitlements(userId, siteId = "") {
  const subscription = siteId ? await activePaidSubscriptionForSite(userId, siteId) : await activePaidSubscription(userId);
  const features = subscription?.features && typeof subscription.features === "object" ? subscription.features : {};
  const granted = Object.fromEntries(Object.values(REMOTE_FEATURES).map((key) => [key, featureEnabled(subscription, key)]));
  return {
    active: Boolean(subscription),
    source: subscription?.grant_source || null,
    site_id: siteId ? String(siteId) : null,
    plan: subscription ? {
      id: subscription.plan_id,
      name: subscription.plan_name,
      expires_at: subscription.expires_at,
      features,
      owner_user_id: subscription.owner_user_id || null,
    } : null,
    features: granted,
  };
}

export async function requireFeature(userId, feature) {
  const subscription = await activePaidSubscription(userId);
  if (!featureEnabled(subscription, feature)) {
    const error = new Error("این قابلیت فقط برای مشتریان دارای پلن فعال مینی‌اپ جارچی در دسترس است.");
    error.status = 402; error.code = "plan_required"; error.feature = feature;
    throw error;
  }
  return { ...subscription, grant_source: "user" };
}

export async function requireFeatureForSite(userId, siteId, feature) {
  const subscription = await activePaidSubscriptionForSite(userId, siteId);
  if (!featureEnabled(subscription, feature)) {
    const error = new Error("این قابلیت فقط برای مدیران سایتی که پلن فعال مینی‌اپ جارچی دارند در دسترس است.");
    error.status = 402; error.code = "plan_required"; error.feature = feature; error.site_id = siteId;
    throw error;
  }
  return subscription;
}

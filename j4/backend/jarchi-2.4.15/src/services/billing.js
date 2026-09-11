import crypto from "node:crypto";
import { query, tx } from "../db/db.js";
import { PLAN_DAYS } from "../core/plans.js";
import { logger } from "../logger.js";
import { Filters, parsePagination, paginated } from "../utils/pagination.js";

function makeInvoiceId() {
  return `JAR-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function getPlans() {
  return (await query(
    `SELECT id,name,duration_days,price_toman,telegram_stars,is_trial,features
     FROM plans WHERE active=true ORDER BY duration_days`,
  )).rows;
}

export async function currentSubscription(userId) {
  return (await query(
    `SELECT s.*,p.name plan_name,p.duration_days,p.price_toman,p.telegram_stars,p.is_trial
     FROM subscriptions s JOIN plans p ON p.id=s.plan_id
     WHERE s.user_id=$1 ORDER BY s.expires_at DESC LIMIT 1`,
    [userId],
  )).rows[0] || null;
}

export async function ensureTrial(userId) {
  const current = await currentSubscription(userId);
  if (current) return current;

  const now = new Date();
  const expires = new Date(now.getTime() + PLAN_DAYS.trial_7d * 86400000);
  await query(
    `INSERT INTO subscriptions(user_id,plan_id,starts_at,expires_at,status,source)
     VALUES($1,'trial_7d',$2,$3,'active','trial')`,
    [userId, now, expires],
  );
  const subscription = await currentSubscription(userId);
  logger.info("trial ensured",{user_id:userId,subscription_id:subscription?.id,expires_at:subscription?.expires_at});
  return subscription;
}

export async function createInvoice(userId, planId, paymentMethod = "website_gateway") {
  if (!PLAN_DAYS[planId] || planId === "trial_7d") {
    throw new Error("Invalid paid plan");
  }

  const plan = (await query(
    "SELECT * FROM plans WHERE id=$1 AND active=true",
    [planId],
  )).rows[0];
  if (!plan) throw new Error("Plan not found");

  const publicId = makeInvoiceId();
  return (await query(
    `INSERT INTO invoices(public_id,user_id,plan_id,amount_toman,currency,payment_method,status)
     VALUES($1,$2,$3,$4,'TOMAN',$5,'pending') RETURNING *`,
    [publicId, userId, planId, plan.price_toman, paymentMethod],
  )).rows[0];
}

export async function activateInvoice(publicId, providerReference, metadata = {}) {
  return tx(async (client) => {
    const invoiceResult = await client.query(
      `SELECT i.*,p.duration_days
       FROM invoices i JOIN plans p ON p.id=i.plan_id
       WHERE i.public_id=$1 FOR UPDATE`,
      [publicId],
    );
    if (!invoiceResult.rowCount) throw new Error("Invoice not found");

    const invoice = invoiceResult.rows[0];
    if (invoice.status === "paid") {
      const existing = await client.query(
        "SELECT * FROM subscriptions WHERE invoice_id=$1 ORDER BY id DESC LIMIT 1",
        [invoice.id],
      );
      return {
        invoice,
        subscription: existing.rows[0] || null,
        already: true,
      };
    }

    await client.query(
      `UPDATE invoices
       SET status='paid',gateway_transaction_id=$2,metadata=$3,paid_at=NOW()
       WHERE id=$1`,
      [invoice.id, String(providerReference || ""), JSON.stringify(metadata)],
    );

    const active = await client.query(
      `SELECT expires_at FROM subscriptions
       WHERE user_id=$1 AND status='active' AND expires_at>NOW()
       ORDER BY expires_at DESC LIMIT 1`,
      [invoice.user_id],
    );

    const start = active.rowCount ? new Date(active.rows[0].expires_at) : new Date();
    const expires = new Date(
      start.getTime() + Number(invoice.duration_days) * 86400000,
    );

    const subscription = await client.query(
      `INSERT INTO subscriptions(user_id,plan_id,starts_at,expires_at,status,source,invoice_id)
       VALUES($1,$2,$3,$4,'active','payment',$5)
       RETURNING *`,
      [invoice.user_id, invoice.plan_id, start, expires, invoice.id],
    );

    return {
      invoice,
      subscription: subscription.rows[0],
      already: false,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Administration
 *
 * These wrap the same tables the customer-facing paths above use. They never
 * rewrite a paid invoice: history is append-only, and an admin adjustment
 * creates a new subscription row with source='admin' instead.
 * ------------------------------------------------------------------ */

export async function listSubscriptions(input = {}) {
  const { page, pageSize, limit, offset } = parsePagination(input);
  const filters = new Filters();
  filters
    .add("s.user_id = ?", input.user_id ? Number(input.user_id) : undefined)
    .add("s.plan_id = ?", input.plan_id)
    .add("s.status = ?", input.status)
    .add("s.source = ?", input.source);

  if (input.state === "active") filters.addRaw("s.status='active' AND s.expires_at > NOW()");
  if (input.state === "expiring") {
    filters.addRaw("s.status='active' AND s.expires_at > NOW() AND s.expires_at <= NOW() + INTERVAL '7 days'");
  }
  if (input.state === "expired") filters.addRaw("(s.status='expired' OR s.expires_at <= NOW())");
  if (input.q) {
    const term = filters.next(`%${String(input.q).trim()}%`);
    filters.addRaw(`(u.display_name ILIKE ${term} OR u.username ILIKE ${term})`);
  }

  const where = filters.where();
  const rows = (await query(
    `SELECT s.id,s.user_id,s.plan_id,s.status,s.starts_at,s.expires_at,s.source,s.invoice_id,s.created_at,
            p.name AS plan_name,p.duration_days,
            u.display_name,u.username,
            GREATEST(0, EXTRACT(EPOCH FROM (s.expires_at - NOW()))/86400)::int AS days_remaining
       FROM subscriptions s
       JOIN plans p ON p.id=s.plan_id
       JOIN users u ON u.id=s.user_id
       ${where}
      ORDER BY s.id DESC LIMIT ${limit} OFFSET ${offset}`,
    filters.params,
  )).rows;

  const total = (await query(
    `SELECT COUNT(*)::int AS count FROM subscriptions s JOIN users u ON u.id=s.user_id ${where}`,
    filters.params,
  )).rows[0].count;
  return paginated(rows, total, { page, pageSize });
}

export async function getSubscription(id) {
  return (await query(
    `SELECT s.*,p.name AS plan_name,p.duration_days,u.display_name,u.username
       FROM subscriptions s JOIN plans p ON p.id=s.plan_id JOIN users u ON u.id=s.user_id
      WHERE s.id=$1`,
    [Number(id)],
  )).rows[0] || null;
}

/** Adds days to a subscription, from its current expiry or from now if lapsed. */
export async function extendSubscription(id, days) {
  const amount = Math.trunc(Number(days));
  if (!Number.isFinite(amount) || amount < 1 || amount > 3650) {
    throw new Error("Extension must be between 1 and 3650 days");
  }
  const row = (await query(
    `UPDATE subscriptions
        SET expires_at = GREATEST(expires_at, NOW()) + ($2||' days')::interval,
            status='active',
            notified_3d_at=NULL, notified_1d_at=NULL, notified_expired_at=NULL
      WHERE id=$1
      RETURNING id,user_id,plan_id,status,starts_at,expires_at`,
    [Number(id), String(amount)],
  )).rows[0];
  if (row) logger.info("subscription extended", { subscription_id: row.id, days: amount, expires_at: row.expires_at });
  return row || null;
}

export async function expireSubscription(id) {
  const row = (await query(
    `UPDATE subscriptions SET status='expired', expires_at=LEAST(expires_at, NOW()),
            notified_expired_at=COALESCE(notified_expired_at,NOW())
      WHERE id=$1 RETURNING id,user_id,status,expires_at`,
    [Number(id)],
  )).rows[0];
  if (row) logger.warn("subscription expired by admin", { subscription_id: row.id });
  return row || null;
}

export async function cancelSubscription(id) {
  const row = (await query(
    "UPDATE subscriptions SET status='cancelled' WHERE id=$1 RETURNING id,user_id,status,expires_at",
    [Number(id)],
  )).rows[0];
  if (row) logger.warn("subscription cancelled by admin", { subscription_id: row.id });
  return row || null;
}

/** Grants a plan to a user without a payment (migration, goodwill, support). */
export async function grantSubscription(userId, planId, { days = null, replaceActive = false } = {}) {
  const plan = (await query("SELECT * FROM plans WHERE id=$1", [String(planId)])).rows[0];
  if (!plan) throw new Error("Plan not found");

  const duration = days ? Math.trunc(Number(days)) : Number(plan.duration_days);
  if (!Number.isFinite(duration) || duration < 1 || duration > 3650) throw new Error("Invalid duration");

  let startDate = new Date();
  if (replaceActive) {
    await query(
      `UPDATE subscriptions
          SET status='cancelled', expires_at=LEAST(expires_at, NOW())
        WHERE user_id=$1 AND status='active' AND expires_at>NOW()`,
      [Number(userId)],
    );
  } else {
    const active = (await query(
      `SELECT expires_at FROM subscriptions
        WHERE user_id=$1 AND status='active' AND expires_at>NOW() ORDER BY expires_at DESC LIMIT 1`,
      [Number(userId)],
    )).rows[0];
    if (active) startDate = new Date(active.expires_at);
  }
  const expires = new Date(startDate.getTime() + duration * 86400000);

  const row = (await query(
    `INSERT INTO subscriptions(user_id,plan_id,starts_at,expires_at,status,source)
     VALUES($1,$2,$3,$4,'active','admin') RETURNING *`,
    [Number(userId), plan.id, startDate, expires],
  )).rows[0];
  logger.info("subscription granted by admin", { subscription_id: row.id, user_id: userId, plan_id: plan.id, days: duration });
  return row;
}

/* ---------------------------- plans ---------------------------- */

export async function listPlans({ includeInactive = false } = {}) {
  return (await query(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM subscriptions s WHERE s.plan_id=p.id) AS subscription_count,
            (SELECT COUNT(*)::int FROM subscriptions s
              WHERE s.plan_id=p.id AND s.status='active' AND s.expires_at > NOW()) AS active_subscription_count,
            (SELECT COUNT(*)::int FROM invoices i WHERE i.plan_id=p.id) AS invoice_count
       FROM plans p
      ${includeInactive ? "" : "WHERE p.active=true"}
      ORDER BY p.is_trial DESC, p.duration_days ASC`,
  )).rows;
}

export async function createPlan(data) {
  const id = String(data.id || "").trim();
  if (!/^[a-z0-9_]{3,32}$/.test(id)) throw new Error("Plan id must be 3-32 characters of a-z, 0-9 or _");
  const duration = Math.trunc(Number(data.duration_days));
  if (!Number.isFinite(duration) || duration < 1 || duration > 3650) throw new Error("Invalid duration_days");

  const row = (await query(
    `INSERT INTO plans(id,name,duration_days,price_toman,telegram_stars,is_trial,active,features)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
    [
      id,
      String(data.name || id).slice(0, 120),
      duration,
      Math.max(0, Math.trunc(Number(data.price_toman) || 0)),
      Math.max(0, Math.trunc(Number(data.telegram_stars) || 0)),
      Boolean(data.is_trial),
      data.active === undefined ? true : Boolean(data.active),
      JSON.stringify(normalizeFeatures(data.features)),
    ],
  )).rows[0];
  logger.info("plan created", { plan_id: row.id });
  return row;
}

/**
 * Editing a plan changes future purchases only. Existing invoices keep the
 * amount they were issued with, so historical billing stays truthful.
 */
export async function updatePlan(id, patch = {}) {
  const updates = [];
  const params = [];
  const push = (sql, value) => { params.push(value); updates.push(sql.replace("?", `$${params.length}`)); };

  if (patch.name !== undefined) push("name=?", String(patch.name).slice(0, 120));
  if (patch.duration_days !== undefined) {
    const duration = Math.trunc(Number(patch.duration_days));
    if (!Number.isFinite(duration) || duration < 1 || duration > 3650) throw new Error("Invalid duration_days");
    push("duration_days=?", duration);
  }
  if (patch.price_toman !== undefined) push("price_toman=?", Math.max(0, Math.trunc(Number(patch.price_toman) || 0)));
  if (patch.telegram_stars !== undefined) push("telegram_stars=?", Math.max(0, Math.trunc(Number(patch.telegram_stars) || 0)));
  if (patch.is_trial !== undefined) push("is_trial=?", Boolean(patch.is_trial));
  if (patch.active !== undefined) push("active=?", Boolean(patch.active));
  if (patch.features !== undefined) push("features=?::jsonb", JSON.stringify(normalizeFeatures(patch.features)));
  if (!updates.length) return (await query("SELECT * FROM plans WHERE id=$1", [String(id)])).rows[0] || null;

  params.push(String(id));
  const row = (await query(
    `UPDATE plans SET ${updates.join(",")},updated_at=NOW() WHERE id=$${params.length} RETURNING *`,
    params,
  )).rows[0];
  if (row) logger.info("plan updated", { plan_id: row.id, fields: Object.keys(patch) });
  return row || null;
}

/**
 * The entitlement flags a plan may carry.
 *
 * The list is closed on purpose: `features` gates paid capability, so an
 * unknown key arriving from a form would either do nothing (confusing) or, if
 * something later started reading it, grant access nobody reviewed. Anything
 * not named here is dropped, and every named flag is always present so a plan
 * never has an "undefined" capability.
 */
export const PLAN_FEATURES = Object.freeze([
  "site_control", "remote_tickets", "remote_announcements", "remote_products", "analytics",
]);

export function normalizeFeatures(input) {
  const features = {};
  for (const key of PLAN_FEATURES) features[key] = input?.[key] === true;
  return features;
}

/**
 * Deletes a plan.
 *
 * Refused while any subscription is still live on it: removing the plan row
 * would leave those customers pointing at nothing, and the entitlement lookup
 * joins through it. Deactivating (`active=false`) is the way to retire a plan
 * that is still in use — it disappears from the storefront and keeps serving
 * the people who already bought it.
 */
export async function deletePlan(id) {
  const planId = String(id || "").trim();
  const plan = (await query("SELECT * FROM plans WHERE id=$1", [planId])).rows[0];
  if (!plan) return { deleted: false, reason: "not_found" };

  // ensureTrial() creates every new customer's subscription on the trial plan
  // by id, so removing it would break signup for everyone — with no active
  // subscription yet to warn us. It is retired by deactivating, like any other.
  if (plan.is_trial || planId === "trial_7d") return { deleted: false, reason: "trial_plan" };

  const active = (await query(
    `SELECT COUNT(*)::int AS count FROM subscriptions
      WHERE plan_id=$1 AND status='active' AND expires_at > NOW()`,
    [planId],
  )).rows[0].count;
  if (active > 0) return { deleted: false, reason: "active_subscriptions", active_subscriptions: active };

  // Historical invoices reference the plan and must keep doing so, so a plan
  // that has ever been billed is retired rather than removed.
  const invoiced = (await query("SELECT COUNT(*)::int AS count FROM invoices WHERE plan_id=$1", [planId])).rows[0].count;
  if (invoiced > 0) return { deleted: false, reason: "has_invoices", invoices: invoiced };

  await query("DELETE FROM subscriptions WHERE plan_id=$1", [planId]);
  await query("DELETE FROM plans WHERE id=$1", [planId]);
  logger.info("plan deleted", { plan_id: planId });
  return { deleted: true, plan };
}

/* --------------------------- invoices --------------------------- */

export async function listInvoices(input = {}) {
  const { page, pageSize, limit, offset } = parsePagination(input);
  const filters = new Filters();
  filters
    .add("i.status = ?", input.status)
    .add("i.user_id = ?", input.user_id ? Number(input.user_id) : undefined)
    .add("i.plan_id = ?", input.plan_id)
    .add("i.payment_method = ?", input.payment_method)
    .add("i.created_at >= ?", input.from)
    .add("i.created_at <= ?", input.to);

  if (input.q) {
    const term = filters.next(`%${String(input.q).trim()}%`);
    filters.addRaw(`(i.public_id ILIKE ${term} OR u.display_name ILIKE ${term} OR u.username ILIKE ${term}
                     OR i.gateway_transaction_id ILIKE ${term})`);
  }

  const where = filters.where();
  const rows = (await query(
    `SELECT i.id,i.public_id,i.user_id,i.plan_id,i.amount_toman,i.currency,i.payment_method,i.status,
            i.gateway,i.gateway_transaction_id,i.paid_at,i.created_at,
            p.name AS plan_name,u.display_name,u.username
       FROM invoices i JOIN plans p ON p.id=i.plan_id JOIN users u ON u.id=i.user_id
       ${where} ORDER BY i.id DESC LIMIT ${limit} OFFSET ${offset}`,
    filters.params,
  )).rows;

  const total = (await query(
    `SELECT COUNT(*)::int AS count FROM invoices i JOIN users u ON u.id=i.user_id ${where}`,
    filters.params,
  )).rows[0].count;
  return paginated(rows, total, { page, pageSize });
}

export async function getInvoice(id) {
  const row = (await query(
    `SELECT i.*,p.name AS plan_name,u.display_name,u.username
       FROM invoices i JOIN plans p ON p.id=i.plan_id JOIN users u ON u.id=i.user_id
      WHERE i.id=$1 OR i.public_id=$2`,
    [Number.isFinite(Number(id)) ? Number(id) : 0, String(id)],
  )).rows[0];
  if (!row) return null;

  const subscription = (await query(
    "SELECT id,plan_id,status,starts_at,expires_at FROM subscriptions WHERE invoice_id=$1 ORDER BY id DESC LIMIT 1",
    [row.id],
  )).rows[0] || null;

  // Gateway metadata can hold provider payloads; strip anything credential-shaped.
  const metadata = Object.fromEntries(
    Object.entries(row.metadata || {}).filter(([key]) => !/token|secret|merchant|key/i.test(key)),
  );
  return { ...row, metadata, subscription };
}

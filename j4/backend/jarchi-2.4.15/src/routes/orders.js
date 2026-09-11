import express from "express";
import { customerAuth, requireOwnedSite } from "../middleware/customerAuth.js";
import { customerApiRateLimit } from "../middleware/rateLimit.js";
import { handler } from "../middleware/respond.js";
import { logger } from "../logger.js";
import * as orders from "../services/orders.js";
import { fetchRemoteOrder, isAllowedStatus, normalizeStatus, pushStatusToWordPress, CORE_STATUSES, OrderSyncError } from "../services/orderSync.js";
import { ORDER_FIELD_GROUPS } from "../core/orderFields.js";

/**
 * WooCommerce orders, for the Mini App.
 *
 * Authorization is the same primitive the rest of the customer API uses:
 * requireOwnedSite resolves the site and sets req.siteRole from
 * sites.owner_user_id or an active site_members row. There is no second
 * ownership model here, and no endpoint below trusts a site id that has not
 * been through it.
 *
 * The important consequence: every order query is scoped by the *resolved*
 * site, so altering an order id in a request cannot reach another site's
 * customers. An order id that belongs elsewhere simply does not match, which is
 * a 404 rather than a leak.
 */
export const orderRoutes = express.Router();

/** Orders are customer data. Reading is owner/admin; writing is owner/admin. */
const ORDER_ROLES = ["owner", "admin"];

orderRoutes.use(
  ["/sites/:siteId/orders", "/sites/:siteId/order-settings"],
  customerAuth,
  customerApiRateLimit(),
);

/**
 * Resolves and authorizes the site named in the path.
 *
 * Returns null when it has already answered, so every handler is one guard
 * clause away from being safe rather than relying on the router order.
 */
async function scope(req, res) {
  const site = await requireOwnedSite(req, res, req.params.siteId, { roles: ORDER_ROLES });

  if (!site) {
    logger.info("orders api authorization denied", {
      request_id: req.requestId,
      site_id: req.params.siteId,
      user_id: req.user?.id,
      // What was refused, not who the customer is.
      path: req.path,
    });
  }

  return site;
}

/* ---------------------------------- list ---------------------------------- */

orderRoutes.get("/sites/:siteId/orders", handler(async (req, res) => {
  const site = await scope(req, res);
  if (!site) return undefined;

  const page = await orders.listOrders(site.id, {
    page: req.query.page,
    perPage: req.query.per_page,
    status: req.query.status,
    search: req.query.search,
  });

  return res.json({
    success: true,
    ...page,
    statuses: CORE_STATUSES,
  });
}));

/* --------------------------------- detail --------------------------------- */

orderRoutes.get("/sites/:siteId/orders/:orderId", handler(async (req, res) => {
  const site = await scope(req, res);
  if (!site) return undefined;

  const orderId = Number(req.params.orderId);

  if (!Number.isFinite(orderId) || orderId <= 0) {
    return res.status(400).json({ success: false, error: "order_id is invalid" });
  }

  const stored = await orders.getOrder(site.id, orderId);

  if (!stored) {
    // Not "forbidden": from this site's point of view the order does not exist,
    // and saying anything more would confirm that it exists somewhere else.
    return res.status(404).json({ success: false, error: "Order not found", error_code: "order_not_found" });
  }

  /*
   * The live order when the shop can be reached, the snapshot when it cannot.
   * A shop being briefly unreachable should show slightly stale figures, not an
   * error page — but the response says which it is, so the screen can too.
   */
  const remote = await fetchRemoteOrder(site.id, orderId);

  return res.json({
    success: true,
    order: remote ? mergeRemote(stored, remote) : stored,
    source: remote ? "woocommerce" : "snapshot",
    statuses: CORE_STATUSES,
  });
}));

/* ----------------------------- status write-back ---------------------------- */

orderRoutes.patch("/sites/:siteId/orders/:orderId/status", handler(async (req, res) => {
  const site = await scope(req, res);
  if (!site) return undefined;

  const orderId = Number(req.params.orderId);
  const requested = normalizeStatus(req.body?.status);

  if (!Number.isFinite(orderId) || orderId <= 0) {
    return res.status(400).json({ success: false, error: "order_id is invalid" });
  }

  if (!isAllowedStatus(requested)) {
    return res.status(422).json({
      success: false,
      error: "وضعیت انتخاب‌شده معتبر نیست",
      error_code: "invalid_status",
      allowed: CORE_STATUSES,
    });
  }

  // The order must already belong to this site. Without this a caller could
  // name any order id and have the backend push a status to somebody's shop.
  const stored = await orders.getOrder(site.id, orderId);

  if (!stored) {
    return res.status(404).json({ success: false, error: "Order not found", error_code: "order_not_found" });
  }

  try {
    const result = await pushStatusToWordPress(site, orderId, requested);

    // The status WordPress confirmed, which is not necessarily the one asked
    // for: WooCommerce applies its own rules to a transition.
    const updated = await orders.applyConfirmedStatus(site.id, orderId, result.status);

    return res.json({
      success: true,
      order: updated || { ...stored, status: result.status },
      status: result.status,
      requested,
      // True when the shop settled somewhere other than the request, so the
      // screen can say so rather than appearing to ignore the click.
      adjusted: result.status !== requested,
      via: result.via,
    });
  } catch (error) {
    const sync = error instanceof OrderSyncError ? error : null;

    logger.warn("order status sync failed", {
      request_id: req.requestId,
      site_id: site.id,
      order_id: orderId,
      requested_status: requested,
      error_code: sync?.code || "sync_failed",
      error: error.message,
    });

    return res.status(sync?.status || 502).json({
      success: false,
      error: persianFor(sync?.code) || "به‌روزرسانی وضعیت در وردپرس انجام نشد",
      error_code: sync?.code || "sync_failed",
      // The order is unchanged here, and saying so stops the screen from
      // showing a status the shop never accepted.
      status: stored.status,
    });
  }
}));

/* ------------------------------ field settings ------------------------------ */

orderRoutes.get("/sites/:siteId/order-settings", handler(async (req, res) => {
  const site = await scope(req, res);
  if (!site) return undefined;

  const settings = await orders.getOrderSettings(site.id);

  return res.json({ success: true, settings, groups: ORDER_FIELD_GROUPS });
}));

orderRoutes.patch("/sites/:siteId/order-settings", handler(async (req, res) => {
  const site = await scope(req, res);
  if (!site) return undefined;

  const body = req.body || {};

  if (body.fields !== undefined && (typeof body.fields !== "object" || body.fields === null || Array.isArray(body.fields))) {
    return res.status(400).json({ success: false, error: "fields must be an object" });
  }

  const settings = await orders.saveOrderSettings(site.id, {
    notifyEnabled: body.notify_enabled === undefined ? null : Boolean(body.notify_enabled),
    fields: body.fields === undefined ? null : body.fields,
    actor: `user:${req.user.id}`,
  });

  logger.info("order notification settings changed", {
    request_id: req.requestId,
    site_id: site.id,
    user_id: req.user.id,
    // The keys that were touched, not the customer data they govern.
    keys: body.fields ? Object.keys(body.fields).slice(0, 30) : [],
  });

  return res.json({ success: true, settings, groups: ORDER_FIELD_GROUPS });
}));

/**
 * Overlays the live WooCommerce order onto the stored shape.
 *
 * The response keeps one shape whichever source answered, so the Mini App does
 * not have to branch on `source` to read a total.
 */
function mergeRemote(stored, remote) {
  const lineItems = Array.isArray(remote.line_items) ? remote.line_items : [];

  return {
    ...stored,
    status: normalizeStatus(remote.status) || stored.status,
    currency: remote.currency || stored.currency,
    total: remote.total === undefined || remote.total === null ? stored.total : Number(remote.total),
    customer_name: [remote.billing?.first_name, remote.billing?.last_name].filter(Boolean).join(" ") || stored.customer_name,
    customer_phone: remote.billing?.phone || stored.customer_phone,
    customer_email: remote.billing?.email || stored.customer_email,
    payment_method: remote.payment_method_title || remote.payment_method || stored.payment_method,
    detail: {
      ...(stored.detail || {}),
      subtotal: sumSubtotal(lineItems),
      discount: toNumber(remote.discount_total),
      shipping_total: toNumber(remote.shipping_total),
      tax_total: toNumber(remote.total_tax),
      payment_status: remote.date_paid ? "paid" : (stored.detail?.payment_status || ""),
      transaction_id: remote.transaction_id || "",
      customer_note: remote.customer_note || "",
      created_at: remote.date_created || stored.detail?.created_at || null,
      updated_at: remote.date_modified || null,
      billing_address: flatten(remote.billing),
      shipping_address: flatten(remote.shipping),
      items: lineItems.map((item) => ({
        name: String(item.name || ""),
        quantity: Number(item.quantity || 1),
        total: toNumber(item.total),
        sku: String(item.sku || ""),
        product_id: item.product_id ?? null,
      })),
    },
  };
}

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function sumSubtotal(items) {
  const total = items.reduce((sum, item) => sum + (toNumber(item.subtotal) ?? 0), 0);
  return items.length ? total : null;
}

function flatten(address) {
  if (!address || typeof address !== "object") return "";

  return [
    [address.first_name, address.last_name].filter(Boolean).join(" "),
    address.company, address.address_1, address.address_2,
    address.city, address.state, address.postcode, address.country,
  ].map((part) => String(part || "").trim()).filter(Boolean).join("، ");
}

/** A message the operator can act on, per failure mode. */
function persianFor(code) {
  return {
    wordpress_unreachable: "وردپرس در دسترس نیست. اتصال سایت را بررسی کنید.",
    wordpress_timeout: "وردپرس به‌موقع پاسخ نداد. کمی بعد دوباره تلاش کنید.",
    wordpress_auth_failed: "وردپرس درخواست را نپذیرفت. کلیدهای ووکامرس یا اتصال افزونه را بررسی کنید.",
    wordpress_rejected: "وردپرس این تغییر را رد کرد.",
    order_not_found: "این سفارش در وردپرس پیدا نشد.",
    status_rejected: "ووکامرس این وضعیت را نپذیرفت.",
    sync_unconfirmed: "وردپرس وضعیت نهایی را اعلام نکرد، پس تغییر تأیید نشده است.",
    site_misconfigured: "اتصال این سایت کامل نیست.",
  }[String(code || "")] || "";
}

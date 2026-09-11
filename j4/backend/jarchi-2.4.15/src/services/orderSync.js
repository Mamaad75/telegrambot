import { logger } from "../logger.js";
import { updateOrderStatus as wooUpdateStatus, getOrder as wooGetOrder } from "./woocommerce.js";
import { AiError } from "../ai/errors.js";

/**
 * Writing an order status back to WordPress.
 *
 * The rule this module exists to enforce: the Mini App is told the status
 * WordPress confirmed, never the status it asked for. Reporting success because
 * a request was dispatched is how an operator marks twenty orders complete and
 * discovers the next morning that the shop never heard about any of them.
 *
 * Two transports, in order of authority:
 *
 *   1. The WooCommerce REST API, using the credentials the site already saved
 *      for product publishing. This is WooCommerce's own interface: it applies
 *      the shop's own rules, runs its hooks, and answers with the order as it
 *      now stands.
 *
 *   2. The Jarchi plugin's REST namespace, authenticated with the site's
 *      webhook secret — the same transport the ticket module already uses. A
 *      great many sites have the plugin installed and have never created
 *      WooCommerce API keys, and refusing to work for them would make this
 *      feature depend on a setup step nobody mentioned.
 *
 * Whichever answers, the confirmed status is read back out of its response.
 */

/** Statuses WooCommerce ships with. A site may have more; see below. */
export const CORE_STATUSES = Object.freeze([
  "pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed",
]);

/**
 * Whether a status is one this backend will send.
 *
 * The core list is the floor, not the ceiling. A shop with a custom status —
 * "awaiting-pickup", "sent-to-courier" — is normal, and hard-coding the seven
 * would make those orders unmanageable from the Mini App. So the shape is
 * validated rather than the membership: a slug WooCommerce could have
 * registered. WordPress remains the authority on whether it exists, and says so
 * by rejecting the write.
 *
 * @param {string} status Requested status.
 * @param {string[]} extra Statuses this site is known to support.
 * @returns {boolean} True when it is worth sending.
 */
export function isAllowedStatus(status, extra = []) {
  const value = String(status || "").replace(/^wc-/, "").trim().toLowerCase();
  if (!value) return false;

  if (CORE_STATUSES.includes(value)) return true;
  if (Array.isArray(extra) && extra.map((item) => String(item || "").toLowerCase()).includes(value)) return true;

  // A slug, and nothing else. This is not a guess that the status exists; it is
  // a refusal to put arbitrary text into a request to somebody's shop.
  return /^[a-z0-9][a-z0-9-]{1,31}$/.test(value);
}

/** Normalises a status the way WooCommerce writes it internally. */
export function normalizeStatus(status) {
  return String(status || "").replace(/^wc-/, "").trim().toLowerCase();
}

/**
 * An error the Mini App can act on.
 *
 * Every failure mode gets its own code so the screen can say what happened
 * rather than "something went wrong": the operator's next move is different for
 * "the shop is down" and "WordPress refused that status".
 */
export class OrderSyncError extends Error {
  constructor(code, message, { status = 502, detail = "" } = {}) {
    super(message);
    this.name = "OrderSyncError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Sends a status change to WordPress and reports what it actually did.
 *
 * @param {object} site   Site row.
 * @param {number} orderId
 * @param {string} status Requested status.
 * @returns {Promise<{status: string, via: string, order: object|null}>} Confirmed state.
 */
export async function pushStatusToWordPress(site, orderId, status) {
  const wanted = normalizeStatus(status);
  const siteId = String(site?.id || "");

  logger.info("woocommerce status update requested", {
    site_id: siteId,
    order_id: orderId,
    requested_status: wanted,
  });

  let wooError = null;

  // 1. WooCommerce REST, when the site has credentials saved.
  try {
    const updated = await wooUpdateStatus(siteId, orderId, wanted);
    const confirmed = normalizeStatus(updated?.status);

    if (!confirmed) {
      throw new OrderSyncError("sync_unconfirmed", "WooCommerce did not report a status", { status: 502 });
    }

    logger.info("woocommerce status update confirmed", {
      site_id: siteId, order_id: orderId, confirmed_status: confirmed, via: "woocommerce",
    });

    return { status: confirmed, via: "woocommerce", order: updated };
  } catch (error) {
    wooError = error;

    // A missing connection is not a failure worth reporting yet — it is the
    // signal to try the plugin instead.
    if (!isMissingConnection(error)) {
      logger.warn("woocommerce status update failed", {
        site_id: siteId, order_id: orderId, error: error.message, code: error.code,
      });
    }
  }

  // 2. The Jarchi plugin, authenticated with the site's webhook secret.
  try {
    const viaPlugin = await pushViaPlugin(site, orderId, wanted);

    logger.info("woocommerce status update confirmed", {
      site_id: siteId, order_id: orderId, confirmed_status: viaPlugin.status, via: "plugin",
    });

    return { ...viaPlugin, via: "plugin" };
  } catch (pluginError) {
    logger.error("woocommerce status sync failed", {
      site_id: siteId,
      order_id: orderId,
      requested_status: wanted,
      woo_error: wooError?.message || "",
      plugin_error: pluginError.message,
    });

    // The WooCommerce error is the more informative of the two when there was
    // a real connection to fail against.
    throw translate(wooError && !isMissingConnection(wooError) ? wooError : pluginError);
  }
}

/** Reads one order back from WooCommerce, for the detail screen. */
export async function fetchRemoteOrder(siteId, orderId) {
  try {
    return await wooGetOrder(siteId, orderId);
  } catch (error) {
    // The caller falls back to the stored snapshot; a shop being unreachable
    // should degrade the screen, not break it.
    logger.info("woocommerce order fetch failed, using snapshot", {
      site_id: siteId, order_id: orderId, error: error.message,
    });
    return null;
  }
}

/** True when the site simply has no WooCommerce credentials saved. */
function isMissingConnection(error) {
  return /not configured|no woocommerce connection|connection not found/i.test(String(error?.message || ""));
}

/**
 * The Jarchi plugin's own order endpoint.
 *
 * Same transport and same authentication as the ticket module: the site's
 * webhook secret, which is already provisioned for every connected site. No
 * credentials are constructed here and none are logged.
 */
async function pushViaPlugin(site, orderId, status) {
  const base = String(site?.wordpress_url || "").replace(/\/+$/, "");
  const secret = String(site?.webhook_secret || "").trim();

  if (!/^https?:\/\//i.test(base)) {
    throw new OrderSyncError("site_misconfigured", "Site has no valid WordPress URL", { status: 400 });
  }
  if (!secret) {
    throw new OrderSyncError("site_misconfigured", "Site has no webhook secret", { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.WP_ORDER_HTTP_TIMEOUT_MS || 12000));

  let response;
  try {
    response = await fetch(`${base}/wp-json/jarchi/v1/orders/${encodeURIComponent(orderId)}/status`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Jarchi-Secret": secret,
        "X-Webhook-Secret": secret,
        "X-Site-ID": String(site.id),
      },
      body: JSON.stringify({ status }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new OrderSyncError(
      error?.name === "AbortError" ? "wordpress_timeout" : "wordpress_unreachable",
      error?.name === "AbortError" ? "WordPress did not answer in time" : `WordPress unreachable: ${error.message}`,
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }

  if (response.status === 401 || response.status === 403) {
    throw new OrderSyncError("wordpress_auth_failed", "WordPress refused the request", {
      status: 502, detail: payload?.message || "",
    });
  }
  if (response.status === 404) {
    throw new OrderSyncError("order_not_found", "WordPress does not have that order", { status: 404 });
  }
  if (!response.ok) {
    throw new OrderSyncError("wordpress_rejected", payload?.message || `WordPress returned ${response.status}`, {
      status: 502, detail: payload?.code || "",
    });
  }

  const confirmed = normalizeStatus(payload?.status ?? payload?.order?.status);

  if (!confirmed) {
    // The plugin answered 200 without saying what the order is now. That is not
    // a confirmation, and treating it as one is exactly the optimistic success
    // this module exists to avoid.
    throw new OrderSyncError("sync_unconfirmed", "WordPress did not report the resulting status", { status: 502 });
  }

  return { status: confirmed, order: payload?.order || null };
}

/** Turns a transport error into one the API layer can answer with. */
function translate(error) {
  if (error instanceof OrderSyncError) return error;

  const message = String(error?.message || "");

  if (error instanceof AiError) {
    if (/auth/i.test(error.code || "") || /auth/i.test(message)) {
      return new OrderSyncError("wordpress_auth_failed", "WooCommerce refused the credentials", { status: 502 });
    }
    if (/timed out/i.test(message)) {
      return new OrderSyncError("wordpress_timeout", "WooCommerce did not answer in time", { status: 504 });
    }
  }

  if (/404/.test(message)) {
    return new OrderSyncError("order_not_found", "WooCommerce does not have that order", { status: 404 });
  }
  if (/400/.test(message) || /invalid/i.test(message)) {
    return new OrderSyncError("status_rejected", "WooCommerce rejected that status", { status: 422, detail: message });
  }

  return new OrderSyncError("sync_failed", message || "Status update failed", { status: 502 });
}

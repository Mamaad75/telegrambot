import { config } from "../config.js";
import { logger } from "../logger.js";
import { sendTelegramMessage } from "../platforms/telegram.js";
import { formatOrderNotification, statusChangeTitle } from "../formatters/order.js";
import { normalizeOrder } from "../core/orderNormalizer.js";
import {
  claimOrderEvent,
  recordNotification,
  upsertOrder,
  getOrderSettings,
  orderNotificationTargets,
} from "./orders.js";

/**
 * Receiving a WooCommerce order and telling the right person about it.
 *
 * Two properties this module is responsible for, and both are about who and how
 * often rather than about formatting:
 *
 *   - Exactly once per event. The claim is a single INSERT against a unique
 *     index, so two concurrent deliveries of the same transition cannot both
 *     notify.
 *
 *   - Only this site's people. An order carries a customer's name, telephone
 *     number and address. The recipients come from this site's ownership and
 *     membership rows, never from a global administrator list, so an admin of
 *     another site is not merely unlikely to be told — there is no path by
 *     which they could be.
 */

/** A new order is worth announcing; so is a status change, differently. */
function isCreation(eventType) {
  const type = String(eventType || "").toLowerCase();
  return type.endsWith(".created") || type.endsWith(".new") || type === "order.created";
}

/**
 * The Mini App link for one site's orders.
 *
 * Carries no secret. The Mini App authenticates the viewer through the existing
 * Telegram launch flow, and every order endpoint re-checks that viewer's access
 * to that site server-side — so a link that leaked would show its holder
 * nothing they could not already reach.
 *
 * @param {string} siteId
 * @param {number|null} orderId Deep link straight to one order, when known.
 * @returns {string} Absolute URL, or "" when the app has no public base URL.
 */
export function ordersPanelUrl(siteId, orderId = null) {
  const base = String(config.publicBaseUrl || "").replace(/\/+$/, "");
  if (!base) return "";

  const params = new URLSearchParams({ site: String(siteId) });
  // The route the Mini App reads on launch. `orders/<id>` opens that order;
  // `orders` opens the list.
  params.set("route", orderId ? `orders/${Number(orderId)}` : "orders");

  return `${base}/app/?platform=telegram#${params.toString()}`;
}

/**
 * Handles one order event end to end.
 *
 * @param {object} site    Authenticated site row.
 * @param {object} payload Raw webhook body.
 * @param {object} options
 * @param {string} options.requestId
 * @returns {Promise<{accepted: boolean, duplicate: boolean, order_id: number, notified: number, reason?: string}>}
 */
export async function ingestOrderEvent(site, payload, { requestId = "" } = {}) {
  const order = normalizeOrder(payload, site?.id);

  if (!order.order_id) {
    logger.warn("woocommerce order event rejected", {
      request_id: requestId, site_id: site?.id, reason: "missing_order_id",
    });
    return { accepted: false, duplicate: false, order_id: 0, notified: 0, reason: "missing_order_id" };
  }

  logger.info("woocommerce order event received", {
    request_id: requestId,
    site_id: site.id,
    order_id: order.order_id,
    event_type: order.event_type,
    status: order.status,
    item_count: order.items.length,
  });

  /*
   * The snapshot is written before the claim, and on every delivery including
   * duplicates. A repeated event is not new information to announce, but it is
   * still the most recent thing the shop has said about this order, and the
   * list should reflect it.
   */
  await upsertOrder(order);

  const claimed = await claimOrderEvent({
    siteId: site.id,
    orderId: order.order_id,
    eventType: order.event_type,
    eventStatus: order.event_status,
  });

  if (!claimed) {
    logger.info("duplicate order event skipped", {
      request_id: requestId,
      site_id: site.id,
      order_id: order.order_id,
      event_type: order.event_type,
      event_status: order.event_status,
    });
    return { accepted: true, duplicate: true, order_id: order.order_id, notified: 0 };
  }

  const notified = await notifySiteAdmins(site, order, { requestId });

  return { accepted: true, duplicate: false, order_id: order.order_id, notified };
}

/**
 * Sends the notification to this site's owner and admins.
 *
 * Never throws: an order that was stored and then failed to notify is a
 * delivery problem, and turning it into a webhook failure would make WordPress
 * retry — which would store it again and, because the event is already claimed,
 * still not notify.
 *
 * @returns {Promise<number>} How many recipients were reached.
 */
async function notifySiteAdmins(site, order, { requestId = "" } = {}) {
  const settings = await getOrderSettings(site.id);

  if (!settings.notify_enabled) {
    logger.info("order notification suppressed by site settings", {
      request_id: requestId, site_id: site.id, order_id: order.order_id,
    });
    await recordNotification({
      siteId: site.id, orderId: order.order_id,
      eventType: order.event_type, eventStatus: order.event_status,
    });
    return 0;
  }

  const targets = await orderNotificationTargets(site);

  if (!targets.length) {
    await recordNotification({
      siteId: site.id, orderId: order.order_id,
      eventType: order.event_type, eventStatus: order.event_status,
      error: "no_recipient",
    });
    return 0;
  }

  const { text } = formatOrderNotification(order, {
    fields: settings.fields,
    title: isCreation(order.event_type) ? "🛒 <b>سفارش جدید ووکامرس</b>" : statusChangeTitle(order),
  });

  const url = ordersPanelUrl(site.id, order.order_id);
  const options = {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  // A Mini App button, when this deployment has a public base URL to open.
  if (url) {
    options.reply_markup = {
      inline_keyboard: [[{ text: "📦 باز کردن پنل سفارش‌ها", web_app: { url } }]],
    };
  }

  let delivered = 0;
  let lastError = "";

  for (const target of targets) {
    try {
      await sendTelegramMessage(target.chat_id, text, options);
      delivered += 1;

      logger.info("order notification sent", {
        request_id: requestId,
        site_id: site.id,
        order_id: order.order_id,
        role: target.role,
        // The chat id is an identifier for a person; the role is what matters
        // for diagnosing "who was told", so the id itself is not logged.
      });
    } catch (error) {
      lastError = String(error?.message || "send failed").slice(0, 300);

      logger.warn("order notification failed", {
        request_id: requestId,
        site_id: site.id,
        order_id: order.order_id,
        role: target.role,
        error: lastError,
      });
    }
  }

  await recordNotification({
    siteId: site.id,
    orderId: order.order_id,
    eventType: order.event_type,
    eventStatus: order.event_status,
    error: delivered ? "" : lastError || "no_delivery",
  });

  return delivered;
}

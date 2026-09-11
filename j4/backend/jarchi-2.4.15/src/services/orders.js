import { query } from "../db/db.js";
import { logger } from "../logger.js";
import { sanitizeOrderFieldMap, describeOrderFields, resolveOrderFields } from "../core/orderFields.js";

/**
 * WooCommerce order storage.
 *
 * The snapshot exists so the Mini App list can be answered from one indexed
 * query instead of paging a remote REST API on every scroll, and so the order
 * screen still shows something when the shop is unreachable. WooCommerce stays
 * the system of record: every write goes back to it, and what is kept here is
 * the last thing the site told us.
 */

const LIST_COLUMNS = `site_id, order_id, order_number, status, currency, total,
  customer_id, customer_name, customer_phone, customer_email, payment_method,
  admin_url, remote_created_at, last_event_type, last_synced_at, updated_at`;

/**
 * Claims one order event, atomically.
 *
 * The whole point is that this is a single statement. WooCommerce raises the
 * same transition more than once by itself — a gateway callback racing the
 * thank-you page, a retried webhook, an administrator re-saving an order — and
 * two concurrent requests both pass a read-then-write check and both notify.
 * `ON CONFLICT DO NOTHING` makes the database the arbiter: exactly one caller
 * gets a row back, and everybody else gets nothing and stops.
 *
 * @param {object} params
 * @param {string} params.siteId
 * @param {number} params.orderId
 * @param {string} params.eventType
 * @param {string} params.eventStatus Status the event is about, "" for creation.
 * @returns {Promise<boolean>} True for the one caller that won the claim.
 */
export async function claimOrderEvent({ siteId, orderId, eventType, eventStatus = "" }) {
  const result = await query(
    `INSERT INTO wc_order_events (site_id, order_id, event_type, event_status)
          VALUES ($1,$2,$3,$4)
     ON CONFLICT (site_id, order_id, event_type, event_status) DO NOTHING
       RETURNING id`,
    [String(siteId), Number(orderId), String(eventType), String(eventStatus || "")],
  );

  return result.rowCount === 1;
}

/** Records what happened to the notification for a claimed event. */
export async function recordNotification({ siteId, orderId, eventType, eventStatus = "", error = "" }) {
  await query(
    `UPDATE wc_order_events
        SET notified_at = CASE WHEN $5 = '' THEN NOW() ELSE notified_at END,
            notify_error = $5
      WHERE site_id=$1 AND order_id=$2 AND event_type=$3 AND event_status=$4`,
    [String(siteId), Number(orderId), String(eventType), String(eventStatus || ""), String(error || "").slice(0, 500)],
  );
}

/**
 * Writes the latest known state of one order.
 *
 * An upsert rather than an insert: the same order arrives again on every status
 * change, and the list should show where it is now, not where it started.
 *
 * @param {object} order Normalised order.
 * @returns {Promise<object>} The stored row.
 */
export async function upsertOrder(order) {
  const row = (await query(
    `INSERT INTO wc_orders (
        site_id, order_id, order_number, status, currency, total,
        customer_id, customer_name, customer_phone, customer_email,
        payment_method, payload, admin_url, remote_created_at, last_event_type, last_synced_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,NOW())
     ON CONFLICT (site_id, order_id) DO UPDATE SET
        order_number   = EXCLUDED.order_number,
        status         = EXCLUDED.status,
        currency       = EXCLUDED.currency,
        total          = EXCLUDED.total,
        customer_id    = COALESCE(EXCLUDED.customer_id, wc_orders.customer_id),
        customer_name  = CASE WHEN EXCLUDED.customer_name  <> '' THEN EXCLUDED.customer_name  ELSE wc_orders.customer_name  END,
        customer_phone = CASE WHEN EXCLUDED.customer_phone <> '' THEN EXCLUDED.customer_phone ELSE wc_orders.customer_phone END,
        customer_email = CASE WHEN EXCLUDED.customer_email <> '' THEN EXCLUDED.customer_email ELSE wc_orders.customer_email END,
        payment_method = CASE WHEN EXCLUDED.payment_method <> '' THEN EXCLUDED.payment_method ELSE wc_orders.payment_method END,
        payload        = EXCLUDED.payload,
        admin_url      = CASE WHEN EXCLUDED.admin_url <> '' THEN EXCLUDED.admin_url ELSE wc_orders.admin_url END,
        -- A status-change event may not repeat the creation date; keep the one
        -- we already have rather than blanking the list's sort column.
        remote_created_at = COALESCE(EXCLUDED.remote_created_at, wc_orders.remote_created_at),
        last_event_type   = EXCLUDED.last_event_type,
        last_synced_at    = NOW(),
        updated_at        = NOW()
     RETURNING ${LIST_COLUMNS}`,
    [
      String(order.site_id),
      Number(order.order_id),
      String(order.order_number || ""),
      String(order.status || ""),
      String(order.currency || ""),
      order.total,
      order.customer_id,
      String(order.customer_name || ""),
      String(order.customer_phone || ""),
      String(order.customer_email || ""),
      String(order.payment_method || ""),
      JSON.stringify(order),
      String(order.admin_url || ""),
      order.created_at || null,
      String(order.event_type || ""),
    ],
  )).rows[0];

  return row;
}

/** Statuses a caller may filter by. Anything else is ignored rather than queried. */
const FILTERABLE = new Set([
  "pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed",
]);

/**
 * One page of a site's orders.
 *
 * Always site-scoped in SQL. A list endpoint that filters in the application
 * has already read another site's rows, and the pager and the counts would be
 * computed from them.
 *
 * @param {string} siteId
 * @param {object} options
 * @returns {Promise<{orders: object[], page: number, per_page: number, total: number, pages: number}>}
 */
export async function listOrders(siteId, { page = 1, perPage = 20, status = "", search = "" } = {}) {
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(perPage) || 20)));
  const current = Math.max(1, Math.trunc(Number(page) || 1));
  const offset = (current - 1) * limit;

  const where = ["site_id = $1"];
  const params = [String(siteId)];

  const wanted = String(status || "").trim().toLowerCase();
  if (wanted && FILTERABLE.has(wanted)) {
    params.push(wanted);
    where.push(`status = $${params.length}`);
  }

  const term = String(search || "").trim().slice(0, 60);
  if (term) {
    /*
     * Order number, customer name, or the order id typed exactly — which is
     * what somebody has in front of them when a customer telephones. Two
     * parameters, because the id is an equality test and cannot share the
     * wildcard pattern the other two need.
     */
    params.push(`%${term.replace(/[%_\\]/g, (char) => `\\${char}`)}%`);
    const pattern = params.length;
    params.push(term);
    const exact = params.length;

    where.push(
      `(order_number ILIKE $${pattern} OR customer_name ILIKE $${pattern} OR order_id::text = $${exact})`,
    );
  }

  const clause = where.join(" AND ");

  const total = Number((await query(`SELECT COUNT(*)::int AS count FROM wc_orders WHERE ${clause}`, params)).rows[0]?.count || 0);

  params.push(limit, offset);
  const rows = (await query(
    `SELECT ${LIST_COLUMNS}
       FROM wc_orders
      WHERE ${clause}
      ORDER BY remote_created_at DESC NULLS LAST, order_id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )).rows;

  return {
    orders: rows.map(shapeListRow),
    page: current,
    per_page: limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * One order's stored snapshot.
 *
 * The site id is a parameter, not a filter applied afterwards, so an order id
 * belonging to another site simply does not match.
 */
export async function getOrder(siteId, orderId) {
  const row = (await query(
    `SELECT ${LIST_COLUMNS}, payload FROM wc_orders WHERE site_id=$1 AND order_id=$2 LIMIT 1`,
    [String(siteId), Number(orderId)],
  )).rows[0];

  if (!row) return null;

  return { ...shapeListRow(row), detail: row.payload || {} };
}

/** Records a status this backend has just confirmed with WooCommerce. */
export async function applyConfirmedStatus(siteId, orderId, status) {
  const row = (await query(
    `UPDATE wc_orders
        SET status=$3, last_synced_at=NOW(), updated_at=NOW()
      WHERE site_id=$1 AND order_id=$2
      RETURNING ${LIST_COLUMNS}`,
    [String(siteId), Number(orderId), String(status)],
  )).rows[0];

  return row ? shapeListRow(row) : null;
}

/** Money arrives from PostgreSQL as a string; the API should answer a number. */
function shapeListRow(row) {
  return {
    site_id: row.site_id,
    order_id: Number(row.order_id),
    order_number: row.order_number || String(row.order_id),
    status: row.status || "",
    currency: row.currency || "",
    total: row.total === null || row.total === undefined ? null : Number(row.total),
    customer_id: row.customer_id === null ? null : Number(row.customer_id),
    customer_name: row.customer_name || "",
    customer_phone: row.customer_phone || "",
    customer_email: row.customer_email || "",
    payment_method: row.payment_method || "",
    admin_url: row.admin_url || "",
    created_at: row.remote_created_at,
    last_event_type: row.last_event_type || "",
    last_synced_at: row.last_synced_at,
    updated_at: row.updated_at,
  };
}

/* ----------------------------- site settings ------------------------------ */

/**
 * One site's order-notification settings.
 *
 * An absent row is not "everything off": it is a site that has never opened the
 * screen, and it must keep getting a useful notification. So the absence is
 * resolved against the shipped defaults by the field policy, here and
 * everywhere else.
 */
export async function getOrderSettings(siteId) {
  const row = (await query(
    `SELECT site_id, notify_enabled, fields, updated_by, updated_at
       FROM site_order_settings WHERE site_id=$1 LIMIT 1`,
    [String(siteId)],
  )).rows[0];

  const stored = row?.fields && typeof row.fields === "object" ? row.fields : {};

  return {
    site_id: String(siteId),
    notify_enabled: row ? row.notify_enabled !== false : true,
    // The partial map, as saved.
    fields: sanitizeOrderFieldMap(stored),
    // Every key with its effective state, which is what a formatter asks for.
    resolved: resolveOrderFields(stored),
    // The catalogue as the settings screen needs it.
    catalog: describeOrderFields(stored),
    updated_by: row?.updated_by || "",
    updated_at: row?.updated_at || null,
  };
}

/**
 * Merges a partial field choice into a site's settings.
 *
 * Merged in PostgreSQL rather than read-modify-written in the application, so
 * two operators changing different fields at the same time cannot erase each
 * other's choice.
 */
export async function saveOrderSettings(siteId, { notifyEnabled = null, fields = null, actor = "" } = {}) {
  const patch = fields === null ? null : sanitizeOrderFieldMap(fields);

  await query(
    `INSERT INTO site_order_settings (site_id, notify_enabled, fields, updated_by)
          VALUES ($1, COALESCE($2, true), COALESCE($3::jsonb, '{}'::jsonb), $4)
     ON CONFLICT (site_id) DO UPDATE SET
        notify_enabled = COALESCE($2, site_order_settings.notify_enabled),
        fields = CASE
                   WHEN $3::jsonb IS NULL THEN site_order_settings.fields
                   ELSE COALESCE(site_order_settings.fields, '{}'::jsonb) || $3::jsonb
                 END,
        updated_by = $4,
        updated_at = NOW()`,
    [
      String(siteId),
      notifyEnabled === null ? null : Boolean(notifyEnabled),
      patch === null ? null : JSON.stringify(patch),
      String(actor || "").slice(0, 120),
    ],
  );

  return getOrderSettings(siteId);
}

/**
 * The people who should be told about this site's orders.
 *
 * Only this site's owner and its active admins. An order carries a customer's
 * name, telephone number and address, so "every administrator of the platform"
 * is the wrong audience and another site's admin is not an audience at all.
 *
 * @param {object} site Site row, which already carries owner_telegram_id.
 * @returns {Promise<Array<{chat_id: string, user_id: number|null, role: string}>>}
 */
export async function orderNotificationTargets(site) {
  const recipients = new Map();

  const add = (chatId, userId, role) => {
    const id = String(chatId || "").trim();
    if (!id) return;
    if (!recipients.has(id)) recipients.set(id, { chat_id: id, user_id: userId ?? null, role });
  };

  // The owner's Telegram id is stored on the site itself, which is the one
  // mapping that exists even before the owner has ever opened the Mini App.
  add(site?.owner_telegram_id, site?.owner_user_id ?? null, "owner");

  const rows = (await query(
    `SELECT i.platform_user_id, i.user_id, 'owner' AS role
       FROM identities i
      WHERE i.platform='telegram' AND i.user_id = $2
      UNION
     SELECT i.platform_user_id, i.user_id, m.role
       FROM site_members m
       JOIN identities i ON i.user_id = m.user_id AND i.platform='telegram'
      WHERE m.site_id = $1 AND m.status='active' AND m.role IN ('admin')`,
    [String(site?.id || ""), site?.owner_user_id ?? null],
  )).rows;

  for (const row of rows) add(row.platform_user_id, row.user_id, row.role);

  if (!recipients.size) {
    logger.warn("woocommerce order has no notification target", { site_id: site?.id });
  }

  return [...recipients.values()];
}

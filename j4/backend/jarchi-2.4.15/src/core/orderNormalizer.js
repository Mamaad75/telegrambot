/**
 * Turns whatever a WordPress site sent about an order into one known shape.
 *
 * Written the way `normalizeAd` is: accept several spellings of the same thing,
 * coerce defensively, and never require a field. A WooCommerce shop with no
 * shipping, no discount and a guest checkout is a normal shop, not a malformed
 * payload — the formatter decides what to print, and it can only do that if
 * "absent" and "empty" arrive here as the same thing.
 */

/** Trims a scalar, flattens the object shapes WordPress uses for one value. */
const val = (input) => {
  if (input == null) return "";
  if (Array.isArray(input)) return input.map(val).filter(Boolean).join("، ");
  if (typeof input === "object") return val(input.value ?? input.rendered ?? input.label ?? input.name ?? "");
  return String(input).trim();
};

/** A number, or null. Never NaN, and never a string that looked numeric. */
const num = (input) => {
  if (input === null || input === undefined || input === "") return null;
  // WooCommerce sends money as a string, and Persian sites sometimes send it
  // with a thousands separator already applied.
  const cleaned = typeof input === "string" ? input.replace(/[,\s٬]/g, "") : input;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

/** An ISO timestamp, or "". */
const when = (input) => {
  const text = val(input);
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

/**
 * One postal address, flattened to a single line.
 *
 * Nothing is invented: an address with only a city is one line containing the
 * city, not a line of commas.
 */
function address(input) {
  if (!input || typeof input !== "object") return val(input);

  const name = [val(input.first_name), val(input.last_name)].filter(Boolean).join(" ");
  const parts = [
    name,
    val(input.company),
    val(input.address_1 ?? input.address1 ?? input.address),
    val(input.address_2 ?? input.address2),
    val(input.city),
    val(input.state),
    val(input.postcode ?? input.postal_code),
    val(input.country),
  ].filter(Boolean);

  return parts.join("، ");
}

/**
 * The line items, in a shape the formatter can print without branching.
 *
 * @param {unknown} input Raw items.
 * @returns {Array<{name: string, quantity: number, total: number|null}>} Items.
 */
function items(input) {
  const rows = Array.isArray(input) ? input : [];

  return rows
    .map((row) => ({
      name: val(row?.name ?? row?.title ?? row?.product_name),
      quantity: Math.max(1, Math.trunc(num(row?.quantity ?? row?.qty) ?? 1)),
      total: num(row?.total ?? row?.line_total ?? row?.subtotal),
      sku: val(row?.sku),
      product_id: num(row?.product_id) ?? null,
    }))
    .filter((row) => row.name !== "");
}

/**
 * Normalises one order event.
 *
 * @param {object} payload Raw request body.
 * @param {string} siteId  Site the authenticated webhook resolved to. Always
 *                         wins over anything in the body: a site must not be
 *                         able to file an order against another site.
 * @returns {object} Normalised order.
 */
export function normalizeOrder(payload = {}, siteId = "") {
  const source = payload && typeof payload === "object" ? payload : {};
  // WordPress plugins disagree about whether the order lives at the top level
  // or under `order`; accept both rather than making the plugin care.
  const order = source.order && typeof source.order === "object" ? source.order : source;

  const eventType = String(source.event_type || source.event || "woocommerce.order.created")
    .toLowerCase()
    .trim();

  const orderId = Math.trunc(num(order.order_id ?? order.id ?? source.order_id ?? source.post_id) ?? 0);
  const status = String(val(order.status ?? source.status)).replace(/^wc-/, "").toLowerCase();

  const billing = order.billing ?? order.billing_address ?? null;
  const shipping = order.shipping ?? order.shipping_address ?? null;

  const customerName =
    val(order.customer_name ?? order.customer?.name) ||
    [val(billing?.first_name), val(billing?.last_name)].filter(Boolean).join(" ").trim();

  return {
    // The event.
    event_type: eventType,
    // A transition may legitimately recur for one order, so the status it
    // refers to is part of what makes this event distinct.
    event_status: eventType.includes("status") || eventType.includes("updated") ? status : "",
    site_id: String(siteId || source.site_id || "").trim(),

    // Identity.
    order_id: orderId,
    order_number: val(order.order_number ?? order.number) || (orderId ? String(orderId) : ""),
    status,
    currency: val(order.currency ?? order.currency_code).toUpperCase(),

    // Customer.
    customer_id: Math.trunc(num(order.customer_id ?? order.customer?.id) ?? 0) || null,
    customer_name: customerName,
    customer_phone: val(order.customer_phone ?? order.phone ?? billing?.phone),
    customer_email: val(order.customer_email ?? order.email ?? billing?.email),

    // Payment.
    payment_method: val(order.payment_method_title ?? order.payment_method),
    payment_status: val(order.payment_status ?? (order.date_paid || order.paid ? "paid" : "")),
    transaction_id: val(order.transaction_id),

    // Money. Null rather than 0 when absent: a shop with no shipping line and a
    // shop with free shipping are different statements, and printing "0" for
    // the first is an invention.
    subtotal: num(order.subtotal),
    discount: num(order.discount_total ?? order.discount),
    shipping_total: num(order.shipping_total ?? order.shipping_cost ?? order.shipping),
    tax_total: num(order.total_tax ?? order.tax),
    total: num(order.total ?? order.order_total),

    // Contents.
    items: items(order.items ?? order.line_items ?? order.products),

    // Addresses.
    billing_address: address(billing),
    shipping_address: address(shipping),

    // Provenance.
    created_at: when(order.date_created ?? order.created_at ?? source.created_at),
    updated_at: when(order.date_modified ?? order.updated_at),
    admin_url: val(order.admin_url ?? order.edit_url ?? order.url),
    customer_note: val(order.customer_note ?? order.note),
  };
}

/**
 * Whether an event type is an order event this module handles.
 *
 * Both the namespaced form this version documents and the bare `order.*` form
 * the 1.26.x WordPress plugin already sends, so an existing site gets the new
 * behaviour without being upgraded first.
 *
 * @param {string} eventType Event type.
 * @returns {boolean} True when it is an order event.
 */
export function isOrderEvent(eventType) {
  const type = String(eventType || "").toLowerCase().trim();

  return type.startsWith("woocommerce.order.") || type.startsWith("order.");
}

/**
 * Which parts of an order a notification may show.
 *
 * The advert side already has a field policy: WordPress reports what fields
 * exist, the operator decides which travel, and the formatter asks the policy
 * rather than deciding for itself. An order has a fixed vocabulary instead of a
 * discovered one — WooCommerce always has a total and never has a "mileage" —
 * so the catalogue is code here rather than a table. Everything else follows
 * the same three rules:
 *
 *   1. The catalogue is code, the per-site choice is data.
 *   2. An absent choice means the shipped default, never "off". A site that has
 *      never opened the screen must keep receiving a useful notification.
 *   3. The formatter asks this module. It does not read the settings itself,
 *      so there is exactly one place where "is this field allowed" is decided
 *      and the screen cannot drift from the message.
 *
 * Order notifications carry a customer's name, telephone number and address, so
 * the defaults here are deliberately not "everything": the address fields are
 * off until somebody turns them on.
 */

/**
 * @typedef {object} OrderFieldDefinition
 * @property {string} key        Stable identifier, stored in site_order_settings.
 * @property {string} label      Persian label shown on the settings screen.
 * @property {string} group      Grouping for the Mini App.
 * @property {boolean} default   Whether a site that has chosen nothing shows it.
 * @property {boolean} sensitive Whether it carries personal data.
 */

/** @type {readonly OrderFieldDefinition[]} */
export const ORDER_FIELDS = Object.freeze([
  { key: "order_status", label: "وضعیت سفارش", group: "order", default: true, sensitive: false },
  { key: "created_at", label: "تاریخ ثبت", group: "order", default: true, sensitive: false },
  { key: "payment_method", label: "روش پرداخت", group: "payment", default: true, sensitive: false },
  { key: "payment_status", label: "وضعیت پرداخت", group: "payment", default: false, sensitive: false },

  { key: "customer_name", label: "نام مشتری", group: "customer", default: true, sensitive: true },
  { key: "customer_phone", label: "تلفن مشتری", group: "customer", default: true, sensitive: true },
  { key: "customer_email", label: "ایمیل مشتری", group: "customer", default: false, sensitive: true },

  { key: "products", label: "فهرست کالاها", group: "items", default: true, sensitive: false },
  { key: "quantity", label: "تعداد هر کالا", group: "items", default: true, sensitive: false },

  { key: "subtotal", label: "جمع اقلام", group: "totals", default: false, sensitive: false },
  { key: "discount", label: "تخفیف", group: "totals", default: false, sensitive: false },
  { key: "shipping", label: "هزینه ارسال", group: "totals", default: false, sensitive: false },
  { key: "total", label: "مبلغ کل", group: "totals", default: true, sensitive: false },

  // Addresses are personal data and long. Off unless asked for.
  { key: "billing_address", label: "آدرس صورتحساب", group: "address", default: false, sensitive: true },
  { key: "shipping_address", label: "آدرس ارسال", group: "address", default: false, sensitive: true },

  { key: "order_link", label: "لینک سفارش در وردپرس", group: "order", default: false, sensitive: false },
]);

/** Group labels, in the order the settings screen should show them. */
export const ORDER_FIELD_GROUPS = Object.freeze({
  order: "سفارش",
  customer: "مشتری",
  items: "کالاها",
  totals: "مبالغ",
  payment: "پرداخت",
  address: "آدرس",
});

const BY_KEY = new Map(ORDER_FIELDS.map((field) => [field.key, field]));

/** Whether a key is one this version knows about. */
export function isOrderField(key) {
  return BY_KEY.has(String(key || ""));
}

/**
 * Keeps only the keys this version defines, and only booleans.
 *
 * Settings arrive from the Mini App. Storing whatever it sent would let a
 * client write arbitrary JSON into a column the formatter later reads.
 *
 * @param {unknown} input Raw map.
 * @returns {Record<string, boolean>} Clean partial map.
 */
export function sanitizeOrderFieldMap(input) {
  const map = {};
  if (!input || typeof input !== "object") return map;

  for (const field of ORDER_FIELDS) {
    const value = input[field.key];
    if (typeof value === "boolean") map[field.key] = value;
  }

  return map;
}

/**
 * The effective on/off state of every field for one site.
 *
 * Partial settings are merged over the defaults rather than replacing them, so
 * a field added in a later version appears with its shipped default instead of
 * silently defaulting to off for every site that saved settings before it
 * existed.
 *
 * @param {Record<string, boolean>|null|undefined} stored Saved partial map.
 * @returns {Record<string, boolean>} Every known key.
 */
export function resolveOrderFields(stored) {
  const saved = sanitizeOrderFieldMap(stored);
  const resolved = {};

  for (const field of ORDER_FIELDS) {
    resolved[field.key] = Object.prototype.hasOwnProperty.call(saved, field.key)
      ? saved[field.key]
      : field.default;
  }

  return resolved;
}

/**
 * Whether one field may appear in this site's notification.
 *
 * @param {Record<string, boolean>|null|undefined} stored Saved partial map.
 * @param {string} key Field key.
 * @returns {boolean} True when it may be shown.
 */
export function orderFieldVisible(stored, key) {
  if (!isOrderField(key)) return false;

  return resolveOrderFields(stored)[String(key)] === true;
}

/**
 * The catalogue as the settings screen needs it: definition plus current state.
 *
 * @param {Record<string, boolean>|null|undefined} stored Saved partial map.
 * @returns {Array<OrderFieldDefinition & {enabled: boolean, overridden: boolean}>} Rows.
 */
export function describeOrderFields(stored) {
  const saved = sanitizeOrderFieldMap(stored);
  const resolved = resolveOrderFields(stored);

  return ORDER_FIELDS.map((field) => ({
    ...field,
    enabled: resolved[field.key],
    // Whether this site has an opinion, as opposed to inheriting the default.
    overridden: Object.prototype.hasOwnProperty.call(saved, field.key),
  }));
}

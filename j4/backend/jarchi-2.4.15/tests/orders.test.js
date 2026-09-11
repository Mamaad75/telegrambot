import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOrder, isOrderEvent } from "../src/core/orderNormalizer.js";
import {
  ORDER_FIELDS,
  resolveOrderFields,
  sanitizeOrderFieldMap,
  orderFieldVisible,
  describeOrderFields,
} from "../src/core/orderFields.js";
import { formatOrderNotification, statusLabel, formatMoney } from "../src/formatters/order.js";
import { isAllowedStatus, normalizeStatus, CORE_STATUSES, OrderSyncError } from "../src/services/orderSync.js";
import { recommendFieldPreset } from "../src/core/fieldPreset.js";

/* ------------------------------ normalisation ------------------------------ */

const rawOrder = {
  event_type: "woocommerce.order.created",
  order: {
    id: 12548,
    number: "12548",
    status: "wc-processing",
    currency: "IRT",
    total: "1250000",
    subtotal: "1300000",
    discount_total: "50000",
    shipping_total: "0",
    customer_id: 42,
    payment_method_title: "درگاه زرین‌پال",
    date_created: "2026-03-01T10:30:00",
    billing: { first_name: "علی", last_name: "احمدی", phone: "09120000000", email: "ali@example.ir", city: "تهران", address_1: "خیابان اول" },
    line_items: [
      { name: "محصول الف", quantity: 1, total: "500000" },
      { name: "محصول ب", quantity: 2, total: "750000" },
    ],
  },
};

test("an order event is recognised in both the namespaced and bare spellings", () => {
  assert.equal(isOrderEvent("woocommerce.order.created"), true);
  // The 1.26.x WordPress plugin already sends this form, and a site running it
  // must get the new behaviour without being upgraded first.
  assert.equal(isOrderEvent("order.created"), true);
  assert.equal(isOrderEvent("order.status"), true);
  assert.equal(isOrderEvent("post.published"), false);
  assert.equal(isOrderEvent(""), false);
});

test("a WooCommerce order normalises to one known shape", () => {
  const order = normalizeOrder(rawOrder, "site-a");

  assert.equal(order.site_id, "site-a");
  assert.equal(order.order_id, 12548);
  assert.equal(order.order_number, "12548");
  // The wc- prefix is WooCommerce's internal spelling, not a status.
  assert.equal(order.status, "processing");
  assert.equal(order.total, 1250000);
  assert.equal(order.customer_name, "علی احمدی");
  assert.equal(order.customer_phone, "09120000000");
  assert.equal(order.items.length, 2);
  assert.equal(order.items[1].quantity, 2);
  assert.match(order.billing_address, /علی احمدی/);
  assert.match(order.billing_address, /تهران/);
});

test("the site id always comes from the authenticated webhook, never the body", () => {
  // Otherwise a site could file an order against somebody else's site.
  const order = normalizeOrder({ ...rawOrder, site_id: "someone-else" }, "site-a");

  assert.equal(order.site_id, "site-a");
});

test("a sparse order is normal, not malformed", () => {
  const order = normalizeOrder({ order: { id: 7 } }, "site-a");

  assert.equal(order.order_id, 7);
  assert.equal(order.items.length, 0);
  assert.equal(order.billing_address, "");
  // Null rather than 0: a shop that sent no shipping line and a shop with free
  // shipping are different statements, and printing "0" for the first invents
  // a fact the operator cannot tell from a real one.
  assert.equal(order.shipping_total, null);
  assert.equal(order.total, null);
});

test("money arrives in several spellings and still becomes a number", () => {
  assert.equal(normalizeOrder({ order: { id: 1, total: "1,250,000" } }, "s").total, 1250000);
  assert.equal(normalizeOrder({ order: { id: 1, total: 99.5 } }, "s").total, 99.5);
  assert.equal(normalizeOrder({ order: { id: 1, total: "not money" } }, "s").total, null);
});

test("a status change is keyed on the status it is about", () => {
  // Creation collapses to one event per order; a transition may legitimately
  // recur, so the status is part of what makes the event distinct.
  assert.equal(normalizeOrder({ event_type: "woocommerce.order.created", order: { id: 1, status: "pending" } }, "s").event_status, "");
  assert.equal(normalizeOrder({ event_type: "woocommerce.order.status_changed", order: { id: 1, status: "completed" } }, "s").event_status, "completed");
});

/* ------------------------------- field policy ------------------------------ */

test("a site that has chosen nothing still gets a useful notification", () => {
  const resolved = resolveOrderFields(null);

  assert.equal(resolved.customer_name, true);
  assert.equal(resolved.total, true);
  assert.equal(resolved.products, true);
  assert.equal(resolved.order_status, true);
});

test("personal data is off until somebody turns it on", () => {
  const resolved = resolveOrderFields(null);

  assert.equal(resolved.billing_address, false);
  assert.equal(resolved.shipping_address, false);
  assert.equal(resolved.customer_email, false);
});

test("a partial choice is merged over the defaults, not substituted for them", () => {
  // A field added in a later version must appear with its shipped default,
  // rather than defaulting to off for every site that saved settings before it
  // existed.
  const resolved = resolveOrderFields({ customer_phone: false });

  assert.equal(resolved.customer_phone, false);
  assert.equal(resolved.total, true, "an untouched field keeps its default");
});

test("only known keys and only booleans reach the database", () => {
  const clean = sanitizeOrderFieldMap({
    total: true,
    customer_phone: "yes",
    not_a_field: true,
    __proto__: { polluted: true },
  });

  assert.deepEqual(Object.keys(clean), ["total"]);
});

test("the settings screen can tell a choice from a default", () => {
  const rows = describeOrderFields({ total: false });
  const total = rows.find((row) => row.key === "total");
  const name = rows.find((row) => row.key === "customer_name");

  assert.equal(total.enabled, false);
  assert.equal(total.overridden, true);
  assert.equal(name.enabled, true);
  assert.equal(name.overridden, false, "inheriting the default is not an override");
});

test("every catalogue entry has the shape the screen renders", () => {
  for (const field of ORDER_FIELDS) {
    assert.equal(typeof field.key, "string");
    assert.ok(field.key.length > 0);
    assert.equal(typeof field.label, "string");
    assert.equal(typeof field.default, "boolean");
    assert.equal(typeof field.sensitive, "boolean");
  }
});

/* -------------------------------- formatter -------------------------------- */

test("a field switched off does not appear in the message", () => {
  const order = normalizeOrder(rawOrder, "site-a");

  const withPhone = formatOrderNotification(order, { fields: null }).text;
  assert.match(withPhone, /09120000000/);

  const withoutPhone = formatOrderNotification(order, { fields: { customer_phone: false } }).text;
  assert.doesNotMatch(withoutPhone, /09120000000/);
  // Absent, not blanked: a "—" beside a label still tells the reader a phone
  // number exists, which is what switching it off was meant to prevent.
  assert.doesNotMatch(withoutPhone, /تلفن/);
});

test("switching a field on puts it in the message", () => {
  const order = normalizeOrder(rawOrder, "site-a");

  assert.doesNotMatch(formatOrderNotification(order, { fields: null }).text, /خیابان اول/);
  assert.match(formatOrderNotification(order, { fields: { billing_address: true } }).text, /خیابان اول/);
});

test("the message carries the order number, customer and total by default", () => {
  const text = formatOrderNotification(normalizeOrder(rawOrder, "site-a"), { fields: null }).text;

  assert.match(text, /#12548/);
  assert.match(text, /علی احمدی/);
  assert.match(text, /محصول الف/);
  assert.match(text, /محصول ب/);
  assert.match(text, /× 2/, "quantities are shown when the quantity field is on");
});

test("turning quantities off keeps the product names", () => {
  const text = formatOrderNotification(normalizeOrder(rawOrder, "site-a"), {
    fields: { quantity: false },
  }).text;

  assert.match(text, /محصول ب/);
  assert.doesNotMatch(text, /× 2/);
});

test("an order with nothing optional still produces a message", () => {
  const text = formatOrderNotification(normalizeOrder({ order: { id: 9 } }, "s"), { fields: null }).text;

  assert.match(text, /#9/);
  assert.ok(text.length > 0);
});

test("a missing figure is absent rather than printed as zero", () => {
  const text = formatOrderNotification(normalizeOrder({ order: { id: 9 } }, "s"), {
    fields: { subtotal: true, shipping: true, total: true },
  }).text;

  assert.doesNotMatch(text, /مبلغ کل/);
  assert.doesNotMatch(text, /جمع اقلام/);
});

test("a very long order does not push everything else out of the message", () => {
  const many = { order: { id: 5, line_items: Array.from({ length: 60 }, (_, i) => ({ name: `کالا ${i}`, quantity: 1 })) } };
  const text = formatOrderNotification(normalizeOrder(many, "s"), { fields: null }).text;

  assert.ok(text.length <= 4096, "Telegram refuses anything longer");
  assert.match(text, /قلم دیگر/, "the tail is counted rather than printed");
});

test("HTML in a customer's name cannot break out of the message", () => {
  const text = formatOrderNotification(
    normalizeOrder({ order: { id: 1, billing: { first_name: "<b>x</b><script>alert(1)</script>" } } }, "s"),
    { fields: null },
  ).text;

  assert.doesNotMatch(text, /<script>/);
  assert.match(text, /&lt;/);
});

test("statuses are shown in Persian, and an unknown one as itself", () => {
  assert.equal(statusLabel("processing"), "در حال انجام");
  assert.equal(statusLabel("wc-completed"), "تکمیل‌شده");
  // A shop with a custom status has a real state; hiding its name helps nobody.
  assert.equal(statusLabel("awaiting-pickup"), "awaiting-pickup");
});

test("money is formatted with the shop's own currency", () => {
  assert.match(formatMoney(1250000, "IRT"), /تومان/);
  assert.equal(formatMoney(null, "IRT"), "");
  assert.equal(formatMoney("nonsense", "IRT"), "");
});

/* ------------------------------ status policy ------------------------------ */

test("the core WooCommerce statuses are accepted", () => {
  for (const status of CORE_STATUSES) assert.equal(isAllowedStatus(status), true, status);
});

test("a shop's own custom status is accepted without a rewrite", () => {
  // Hard-coding the seven core statuses would make orders in a custom state
  // unmanageable from the Mini App.
  assert.equal(isAllowedStatus("awaiting-pickup"), true);
  assert.equal(isAllowedStatus("sent-to-courier"), true);
});

test("anything that is not a status slug is refused", () => {
  // This is not a guess that a status exists; it is a refusal to put arbitrary
  // text into a request to somebody's shop.
  assert.equal(isAllowedStatus(""), false);
  assert.equal(isAllowedStatus("a"), false);
  assert.equal(isAllowedStatus("has spaces"), false);
  assert.equal(isAllowedStatus("../../etc/passwd"), false);
  assert.equal(isAllowedStatus("<script>"), false);
  assert.equal(isAllowedStatus("x".repeat(80)), false);
  assert.equal(isAllowedStatus(null), false);
});

test("the wc- prefix is normalised away before anything is sent", () => {
  assert.equal(normalizeStatus("wc-completed"), "completed");
  assert.equal(normalizeStatus("  Processing "), "processing");
});

test("a sync failure carries a code the screen can act on", () => {
  const error = new OrderSyncError("wordpress_timeout", "no answer", { status: 504 });

  assert.equal(error.code, "wordpress_timeout");
  assert.equal(error.status, 504);
  assert.ok(error instanceof Error);
});

/* ------------------------------ field preset ------------------------------- */

const catalog = [
  { field_key: "ad_title", label: "عنوان آگهی", field_type: "text" },
  { field_key: "tozihat", label: "توضیحات", field_type: "textarea" },
  { field_key: "qeymat", label: "قیمت", field_type: "text" },
  { field_key: "shahr", label: "شهر", field_type: "text" },
  { field_key: "tel", label: "تلفن تماس", field_type: "text" },
  { field_key: "rooms", label: "تعداد اتاق", field_type: "number" },
  { field_key: "gallery", label: "گالری تصاویر", field_type: "gallery" },
  { field_key: "internal_ref", label: "کد داخلی", field_type: "text" },
];

test("the recommended preset switches on the shape of a classified advert", () => {
  const plan = recommendFieldPreset(catalog);

  for (const key of ["ad_title", "tozihat", "qeymat", "shahr", "tel"]) {
    assert.ok(plan.enabled.includes(key), `${key} should be published`);
  }
});

test("it hides the gallery and the bookkeeping", () => {
  const plan = recommendFieldPreset(catalog);

  // The gallery travels as photographs on the message; listing it would print
  // a URL where a picture already is.
  assert.ok(plan.hiddenKeys.includes("gallery"));
  assert.ok(plan.hiddenKeys.includes("internal_ref"));
});

test("the order it applies is the reading order of an advert", () => {
  const plan = recommendFieldPreset(catalog);
  const position = Object.fromEntries(plan.apply.map((item) => [item.field_key, item.order]));

  assert.ok(position.ad_title < position.qeymat, "title before price");
  assert.ok(position.qeymat < position.shahr, "price before place");
  assert.ok(position.shahr < position.tel, "place before contact");
});

test("it expresses itself as ordinary field overrides", () => {
  // Not a separate settings store: applying the preset and flipping the toggles
  // by hand must produce exactly the same state.
  const plan = recommendFieldPreset(catalog);
  const title = plan.apply.find((item) => item.field_key === "ad_title");

  assert.equal(title.hidden, false);
  assert.deepEqual(title.platforms, { telegram: true, bale: true, whatsapp: true });
  assert.equal(typeof title.order, "number");

  const hidden = plan.apply.find((item) => item.field_key === "gallery");
  assert.equal(hidden.hidden, true);
  assert.deepEqual(hidden.platforms, { telegram: false, bale: false, whatsapp: false });
});

test("every field is accounted for, none silently dropped", () => {
  const plan = recommendFieldPreset(catalog);

  assert.equal(plan.apply.length, catalog.length);
  assert.equal(plan.enabled.length + plan.hiddenKeys.length, catalog.length);
});

test("one price is informative, twelve is a spreadsheet", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ field_key: `price_${i}`, label: `قیمت ${i}`, field_type: "text" }));
  const plan = recommendFieldPreset(many);

  assert.ok(plan.enabled.length <= 2, `capped, got ${plan.enabled.length}`);
});

test("an Arabic yeh in a field name is still recognised", () => {
  // A site built on an Arabic keyboard writes ي where a Persian one writes ی.
  // They look identical, and matching the literal character would file every
  // such field under "not published".
  const plan = recommendFieldPreset([{ field_key: "x", label: "قيمت", field_type: "text" }]);

  assert.ok(plan.enabled.includes("x"));
});

test("an empty catalog produces an empty plan rather than throwing", () => {
  const plan = recommendFieldPreset([]);

  assert.deepEqual(plan.apply, []);
  assert.deepEqual(plan.enabled, []);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  TEST_ENV, skipWithoutDatabase, resetDatabase, startServer, startWooCommerceDouble, seedCustomer, withPool,
} from "../helpers.mjs";

/**
 * WooCommerce orders, end to end.
 *
 * Against a real database, a real server process and a WooCommerce double that
 * records what it was asked to do. The last part is the point of the status
 * tests: asserting the backend "sent" an update proves nothing, so the shop
 * writes down what it actually received and the test reads it back.
 */

/** The webhook, authenticated the way the WordPress plugin authenticates. */
async function postOrder(baseUrl, site, body) {
  return fetch(`${baseUrl}/webhooks/woocommerce`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Site-ID": site.id,
      "X-Webhook-Secret": "jch_test_secret",
    },
    body: JSON.stringify(body),
  });
}

/** The Mini App, authenticated the way the Mini App authenticates. */
function asCustomer(baseUrl, token) {
  return async (method, path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { status: response.status, body: payload };
  };
}

const ORDER = {
  event_type: "woocommerce.order.created",
  order: {
    id: 5501,
    number: "5501",
    status: "processing",
    currency: "IRT",
    total: "1250000",
    payment_method_title: "زرین‌پال",
    date_created: "2026-03-01T09:00:00",
    billing: { first_name: "علی", last_name: "احمدی", phone: "09120000000", city: "تهران" },
    line_items: [{ name: "محصول الف", quantity: 1, total: "1250000" }],
  },
};

test("WooCommerce orders", { skip: skipWithoutDatabase }, async (t) => {
  await resetDatabase();

  const shop = await startWooCommerceDouble();
  const server = await startServer({ WOOCOMMERCE_ALLOW_PRIVATE_HOSTS: "true" });

  let owner;
  let intruder;

  await withPool(async (pool) => {
    owner = await seedCustomer(pool, {
      telegramId: "950000001", siteId: "site_orders-shop_a1", wordpressUrl: shop.baseUrl,
    });
    intruder = await seedCustomer(pool, {
      telegramId: "950000002", siteId: "site_other-shop_b2", wordpressUrl: shop.baseUrl,
    });

    // The owner's Telegram id is what the notification is addressed to.
    await pool.query("UPDATE sites SET owner_telegram_id=$2 WHERE id=$1", [owner.site.id, "950000001"]);

    // WooCommerce credentials, so the status write-back has a shop to reach.
    const { encryptText } = await import("../../src/utils/security.js");
    await pool.query(
      `INSERT INTO woocommerce_connections(site_id, base_url, consumer_key_enc, consumer_secret_enc, status)
       VALUES($1,$2,$3,$4,'active')
       ON CONFLICT (site_id) DO UPDATE SET base_url=EXCLUDED.base_url`,
      [
        owner.site.id, shop.baseUrl,
        // encryptText takes the key as an argument; the server reads the same
        // value from PLATFORM_CREDENTIAL_KEY, which TEST_ENV supplies to it.
        encryptText("ck_test", TEST_ENV.PLATFORM_CREDENTIAL_KEY),
        encryptText("cs_test", TEST_ENV.PLATFORM_CREDENTIAL_KEY),
      ],
    );
  });

  const api = asCustomer(server.baseUrl, owner.token);
  const otherApi = asCustomer(server.baseUrl, intruder.token);

  t.after(async () => {
    await server.stop();
    await shop.close();
  });

  await t.test("a new order is accepted and stored", async () => {
    const response = await postOrder(server.baseUrl, owner.site, ORDER);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.order_id, 5501);
    assert.equal(body.duplicate, false);
  });

  await t.test("the same event again is recognised as a duplicate", async () => {
    // WooCommerce raises the same transition more than once on its own — a
    // gateway callback racing the thank-you page, a retried webhook — and a
    // customer being told twice is the failure this prevents.
    const response = await postOrder(server.baseUrl, owner.site, ORDER);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.duplicate, true, "the second delivery must not be treated as new");
    assert.equal(body.notified, 0, "and must not notify anybody");
  });

  await t.test("ten simultaneous deliveries still claim the event once", async () => {
    await postOrder(server.baseUrl, owner.site, { ...ORDER, order: { ...ORDER.order, id: 5502 } });

    const burst = await Promise.all(
      Array.from({ length: 10 }, () =>
        postOrder(server.baseUrl, owner.site, { ...ORDER, order: { ...ORDER.order, id: 5503 } })),
    );

    const bodies = await Promise.all(burst.map((response) => response.json()));
    const fresh = bodies.filter((body) => body.duplicate === false);

    assert.equal(fresh.length, 1, `exactly one caller may win the claim, got ${fresh.length}`);
  });

  await t.test("a status change for the same order is its own event", async () => {
    const response = await postOrder(server.baseUrl, owner.site, {
      event_type: "woocommerce.order.status_changed",
      order: { ...ORDER.order, status: "completed" },
    });
    const body = await response.json();

    // A transition may legitimately recur for one order, so creation and a
    // later status change must not collapse onto the same key.
    assert.equal(body.duplicate, false);
  });

  await t.test("an order event without an order id is refused", async () => {
    const response = await postOrder(server.baseUrl, owner.site, {
      event_type: "woocommerce.order.created", order: { number: "x" },
    });

    assert.equal(response.status, 400);
  });

  /* ------------------------------ the API ------------------------------- */

  await t.test("the site owner can list their orders", async () => {
    const { status, body } = await api("GET", `/api/sites/${owner.site.id}/orders`);

    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.ok(body.orders.length >= 3);
    assert.ok(body.orders.every((order) => order.site_id === owner.site.id));
  });

  await t.test("the list is paginated rather than unbounded", async () => {
    const { body } = await api("GET", `/api/sites/${owner.site.id}/orders?per_page=2&page=1`);

    assert.equal(body.orders.length, 2);
    assert.equal(body.per_page, 2);
    assert.ok(body.pages >= 2);
  });

  await t.test("the list can be filtered by status", async () => {
    const { body } = await api("GET", `/api/sites/${owner.site.id}/orders?status=completed`);

    assert.ok(body.orders.every((order) => order.status === "completed"));
  });

  await t.test("another site's admin cannot list these orders", async () => {
    // The intruder is a real, authenticated customer with their own site. What
    // they must not have is any path to this site's customers.
    const { status } = await otherApi("GET", `/api/sites/${owner.site.id}/orders`);

    assert.equal(status, 403);
  });

  await t.test("nor read one of them by id", async () => {
    const { status } = await otherApi("GET", `/api/sites/${owner.site.id}/orders/5501`);

    assert.equal(status, 403);
  });

  await t.test("nor change one of their statuses", async () => {
    const { status } = await otherApi("PATCH", `/api/sites/${owner.site.id}/orders/5501/status`, { status: "completed" });

    assert.equal(status, 403);
  });

  await t.test("an order id from another site is not found rather than served", async () => {
    // Scoped in SQL, so the id simply does not match. A 404 also avoids
    // confirming that the order exists somewhere else.
    const { status } = await otherApi("GET", `/api/sites/${intruder.site.id}/orders/5501`);

    assert.equal(status, 404);
  });

  await t.test("an unauthenticated request is refused", async () => {
    const response = await fetch(`${server.baseUrl}/api/sites/${owner.site.id}/orders`);

    assert.ok([401, 403].includes(response.status), `expected a refusal, got ${response.status}`);
  });

  await t.test("order detail carries the customer and the items", async () => {
    const { status, body } = await api("GET", `/api/sites/${owner.site.id}/orders/5501`);

    assert.equal(status, 200);
    assert.equal(body.order.order_id, 5501);
    assert.equal(body.order.customer_name, "علی احمدی");
    assert.ok(Array.isArray(body.order.detail.items));
  });

  /* --------------------------- status write-back -------------------------- */

  await t.test("an invalid status is refused before anything is sent", async () => {
    const before = shop.state.requests.length;
    const { status, body } = await api("PATCH", `/api/sites/${owner.site.id}/orders/5501/status`, {
      status: "not a status",
    });

    assert.equal(status, 422);
    assert.equal(body.error_code, "invalid_status");
    assert.equal(shop.state.requests.length, before, "nothing should reach the shop");
  });

  await t.test("a valid status is written to WooCommerce, not just to us", async () => {
    shop.state.orders.set(5501, { id: 5501, status: "processing", currency: "IRT", total: "1250000", line_items: [] });

    const { status, body } = await api("PATCH", `/api/sites/${owner.site.id}/orders/5501/status`, {
      status: "completed",
    });

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.status, "completed");

    // The shop's own record, which is the only evidence that matters.
    assert.equal(shop.state.orders.get(5501).status, "completed");

    const put = shop.state.requests.filter((request) => request.method === "PUT" && request.path.endsWith("/orders/5501"));
    assert.ok(put.length >= 1, "WooCommerce should have received a PUT");
  });

  await t.test("and the local list reflects the confirmed status", async () => {
    const { body } = await api("GET", `/api/sites/${owner.site.id}/orders/5501`);

    assert.equal(body.order.status, "completed");
  });

  await t.test("the status WordPress settled on wins over the one requested", async () => {
    shop.state.orders.set(5504, { id: 5504, status: "pending", currency: "IRT", total: "1", line_items: [] });
    await postOrder(server.baseUrl, owner.site, { ...ORDER, order: { ...ORDER.order, id: 5504, status: "pending" } });

    // The shop settles somewhere other than where it was pushed, which
    // WooCommerce genuinely does for some refund workflows.
    shop.state.forceStatus = "on-hold";

    const { status, body } = await api("PATCH", `/api/sites/${owner.site.id}/orders/5504/status`, {
      status: "completed",
    });

    shop.state.forceStatus = "";

    assert.equal(status, 200);
    assert.equal(body.status, "on-hold", "the confirmed status, not the requested one");
    assert.equal(body.adjusted, true);
  });

  await t.test("a WordPress refusal is surfaced, not reported as success", async () => {
    shop.state.orders.set(5505, { id: 5505, status: "pending", currency: "IRT", total: "1", line_items: [] });
    await postOrder(server.baseUrl, owner.site, { ...ORDER, order: { ...ORDER.order, id: 5505, status: "pending" } });

    shop.state.rejectStatus = "refunded";

    const { status, body } = await api("PATCH", `/api/sites/${owner.site.id}/orders/5505/status`, {
      status: "refunded",
    });

    shop.state.rejectStatus = "";

    assert.ok(status >= 400, `a refusal must not answer 2xx, got ${status}`);
    assert.equal(body.success, false);
    assert.ok(body.error_code, "the screen needs a code it can act on");
    // And the order is reported unchanged, so the screen does not show a status
    // the shop never accepted.
    assert.equal(body.status, "pending");
  });

  await t.test("an unreachable shop is reported as such", async () => {
    shop.state.orders.set(5506, { id: 5506, status: "pending", currency: "IRT", total: "1", line_items: [] });
    await postOrder(server.baseUrl, owner.site, { ...ORDER, order: { ...ORDER.order, id: 5506, status: "pending" } });

    shop.setMode("server_error");

    const { status, body } = await api("PATCH", `/api/sites/${owner.site.id}/orders/5506/status`, {
      status: "completed",
    });

    shop.setMode("ok");

    assert.ok(status >= 400);
    assert.equal(body.success, false);
  });

  await t.test("an order the site does not have cannot be pushed to the shop", async () => {
    const { status } = await api("PATCH", `/api/sites/${owner.site.id}/orders/999999/status`, { status: "completed" });

    assert.equal(status, 404);
  });

  /* --------------------------- notification fields ------------------------- */

  await t.test("the site can read its notification field settings", async () => {
    const { status, body } = await api("GET", `/api/sites/${owner.site.id}/order-settings`);

    assert.equal(status, 200);
    assert.ok(Array.isArray(body.settings.catalog));
    assert.equal(body.settings.resolved.customer_name, true);
    assert.equal(body.settings.resolved.billing_address, false, "personal data is off by default");
  });

  await t.test("and change them", async () => {
    const { body } = await api("PATCH", `/api/sites/${owner.site.id}/order-settings`, {
      fields: { customer_phone: false, billing_address: true },
    });

    assert.equal(body.settings.resolved.customer_phone, false);
    assert.equal(body.settings.resolved.billing_address, true);
    // A partial change must not reset the fields it did not mention.
    assert.equal(body.settings.resolved.customer_name, true);
  });

  await t.test("another site's admin cannot change them", async () => {
    const { status } = await otherApi("PATCH", `/api/sites/${owner.site.id}/order-settings`, {
      fields: { customer_phone: true },
    });

    assert.equal(status, 403);
  });

  /* ---------------------------- publication fields ------------------------- */

  await t.test("a site owner can edit publication fields without being a Jarchi operator", async () => {
    /*
     * This is the case the Mini App used to get wrong: the field controls wrote
     * through the platform operator route, so a site owner saw editable
     * switches that answered 403.
     */
    await withPool(async (pool) => {
      await pool.query(
        `INSERT INTO site_field_catalog(site_id, field_key, label, field_order, field_type, visibility)
         VALUES($1,'price','قیمت',1,'text','telegram')
         ON CONFLICT (site_id, field_key) DO NOTHING`,
        [owner.site.id],
      );
    });

    const { status, body } = await api("PATCH", `/api/fields/${owner.site.id}/price`, {
      platforms: { telegram: false },
    });

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.field.effective_platforms.telegram, false);
  });

  await t.test("and that change is the one the formatter reads", async () => {
    const { body } = await api("GET", `/api/fields/${owner.site.id}`);
    const price = body.fields.find((field) => field.field_key === "price");

    // Same column, same read path as publication. Not a second copy.
    assert.equal(price.effective_platforms.telegram, false);
  });

  await t.test("another site's admin cannot edit these fields", async () => {
    const { status } = await otherApi("PATCH", `/api/fields/${owner.site.id}/price`, {
      platforms: { telegram: true },
    });

    assert.equal(status, 403);
  });

  await t.test("the Jarchi Recommended preset applies only when asked", async () => {
    const { status, body } = await api("POST", `/api/fields/${owner.site.id}/preset`, {
      preset: "jarchi_recommended",
    });

    assert.equal(status, 200, JSON.stringify(body));
    assert.ok(body.enabled.includes("price"), "a price belongs in a classified advert");
    assert.equal(body.preset, "jarchi_recommended");
  });

  await t.test("an unknown preset is refused rather than guessed at", async () => {
    const { status } = await api("POST", `/api/fields/${owner.site.id}/preset`, { preset: "something_else" });

    assert.equal(status, 400);
  });

  /* ------------------------ existing behaviour intact ----------------------- */

  await t.test("advert webhooks still require a post_id", async () => {
    // The order branch runs before that guard; it must not have removed it.
    const response = await fetch(`${server.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Site-ID": owner.site.id,
        "X-Webhook-Secret": "jch_test_secret",
      },
      body: JSON.stringify({ event_type: "post.published", title: "no id" }),
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Missing post_id");
  });

  await t.test("a ticket event is not mistaken for an order", async () => {
    // Ticket events were previously rejected with "Missing post_id"; the order
    // branch must not have widened into them.
    const response = await fetch(`${server.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Site-ID": owner.site.id,
        "X-Webhook-Secret": "jch_test_secret",
      },
      body: JSON.stringify({ event_type: "ticket.created", post_id: 77, title: "تیکت" }),
    });

    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.post_id, "77");
    assert.equal(body.order_id, undefined, "a ticket is not an order");
  });

  await t.test("the shared webhook also accepts an order event", async () => {
    // A site running the current WordPress plugin posts order.* to /webhook and
    // must get the new behaviour without being upgraded first.
    const response = await fetch(`${server.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Site-ID": owner.site.id,
        "X-Webhook-Secret": "jch_test_secret",
      },
      body: JSON.stringify({ event_type: "order.created", order: { id: 5600, status: "processing" } }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.order_id, 5600);
  });

  await t.test("a forged webhook secret is refused", async () => {
    const response = await fetch(`${server.baseUrl}/webhooks/woocommerce`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Site-ID": owner.site.id,
        "X-Webhook-Secret": "wrong",
      },
      body: JSON.stringify(ORDER),
    });

    assert.equal(response.status, 401);
  });
});

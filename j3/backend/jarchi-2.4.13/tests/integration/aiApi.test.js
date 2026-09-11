import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  TEST_ENV, skipWithoutDatabase, resetDatabase, startServer, startWooCommerceDouble, seedCustomer, withPool,
} from "../helpers.mjs";

/**
 * The AI product API over real HTTP, against a real server process, a real
 * database and a local WooCommerce double. The provider is the deterministic
 * mock (AI_PROVIDER=mock), so nothing here needs an API key.
 */
test("AI product API", { skip: skipWithoutDatabase }, async (t) => {
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarchi-ai-api-"));
  await resetDatabase();

  const store = await startWooCommerceDouble();
  const server = await startServer({
    AI_ENABLED: "true",
    AI_PROVIDER: "mock",
    AI_MEDIA_DIR: mediaDir,
    AI_ENABLE_IMAGE_GENERATION: "true",
    AI_WORKER_ENABLED: "true",
    AI_WORKER_INTERVAL_MS: "300",
    AI_JOB_BASE_DELAY_MS: "50",
    WOOCOMMERCE_ALLOW_PRIVATE_HOSTS: "true",
  });

  let owner;
  let intruder;
  await withPool(async (pool) => {
    // The site's registered WordPress URL is the store double: saveConnection
    // pins the WooCommerce base URL to the hostname already known for the site.
    owner = await seedCustomer(pool, {
      telegramId: "910000001", siteId: "site_api-shop_a1", wordpressUrl: store.baseUrl,
    });
    intruder = await seedCustomer(pool, {
      telegramId: "910000002", siteId: "site_other-shop_b2", wordpressUrl: store.baseUrl,
    });
  });

  t.after(async () => {
    await server.stop();
    await store.close();
    await fs.rm(mediaDir, { recursive: true, force: true });
  });

  const call = (token, method, url, body, extraHeaders = {}) => {
    const headers = { Authorization: `Bearer ${token}`, ...extraHeaders };
    if (body !== undefined && !Buffer.isBuffer(body)) headers["content-type"] = "application/json";
    return fetch(`${server.baseUrl}${url}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
    }).then(async (response) => ({ status: response.status, data: await response.json().catch(() => null) }));
  };

  const asOwner = (method, url, body, headers) => call(owner.token, method, url, body, headers);
  const asIntruder = (method, url, body, headers) => call(intruder.token, method, url, body, headers);

  /** Waits for the background worker to finish a draft's current job. */
  const waitForStatus = async (draftId, statuses, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { data } = await asOwner("GET", `/api/ai/products/${draftId}`);
      if (statuses.includes(data?.product?.status)) return data.product;
      if (Date.now() > deadline) throw new Error(`Draft stuck in ${data?.product?.status}`);
      await new Promise((resolve) => { setTimeout(resolve, 200); });
    }
  };

  /** Polls one job to a terminal state. */
  const waitForJob = async (jobId, statuses, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { data } = await asOwner("GET", `/api/ai/jobs/${jobId}`);
      if (statuses.includes(data?.job?.status)) return data.job;
      if (Date.now() > deadline) throw new Error(`Job stuck in ${data?.job?.status}`);
      await new Promise((resolve) => { setTimeout(resolve, 200); });
    }
  };

  const makePng = async (width = 300, height = 200) => {
    const { makePng: build } = await import("../../src/ai/providers/mock.js");
    return build(width, height);
  };

  await t.test("AI endpoints require authentication", async () => {
    const response = await fetch(`${server.baseUrl}/api/ai/products`);
    assert.equal(response.status, 401);
    const data = await response.json();
    assert.equal(data.success, false);
  });

  await t.test("status reports capability and the caller's quota", async () => {
    const { status, data } = await asOwner("GET", "/api/ai/status");
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.ai.available, true);
    assert.deepEqual(data.ai.accepted_image_types, ["image/jpeg", "image/png", "image/webp"]);
    assert.equal(data.usage.products.limit, 20);
    assert.equal(data.usage.products.used, 0);
  });

  await t.test("a draft cannot be created against someone else's site", async () => {
    const { status, data } = await asIntruder("POST", "/api/ai/products", {
      site_id: owner.site.id, input: { name: "دزدی" },
    });
    assert.equal(status, 403);
    assert.equal(data.error, "Site access denied");

    const missing = await asOwner("POST", "/api/ai/products", { site_id: "site_does_not_exist", input: { name: "x" } });
    assert.equal(missing.status, 404);
  });

  let draftId = null;

  await t.test("creating a draft starts generation and returns immediately", async () => {
    const started = Date.now();
    const { status, data } = await asOwner("POST", "/api/ai/products", {
      site_id: owner.site.id,
      input: { name: "هدفون بی‌سیم", price: "2450000", color: "سفید" },
    }, { "Idempotency-Key": "api-key-1" });

    assert.equal(status, 201);
    assert.equal(data.success, true);
    assert.ok(data.product.id);
    assert.equal(data.product.status, "draft");
    assert.ok(data.job.id, "a job id is returned for polling");
    assert.ok(Date.now() - started < 3000, "the request does not wait for generation");
    draftId = data.product.id;
  });

  await t.test("the same idempotency key never creates a second draft", async () => {
    const { status, data } = await asOwner("POST", "/api/ai/products", {
      site_id: owner.site.id, input: { name: "هدفون بی‌سیم" },
    }, { "Idempotency-Key": "api-key-1" });

    assert.equal(status, 200);
    assert.equal(data.created, false);
    assert.equal(data.product.id, draftId);

    const list = await asOwner("GET", "/api/ai/products");
    assert.equal(list.data.products.length, 1);
  });

  await t.test("the worker completes generation in the background", async () => {
    const product = await waitForStatus(draftId, ["awaiting_review", "generated"]);
    assert.equal(product.status, "awaiting_review");
    assert.equal(product.generated.title, "هدفون بی‌سیم");
    assert.ok(product.generated.seo_title);
    assert.ok(product.generated.meta_description);
    assert.ok(product.generated.slug);
    assert.ok(Array.isArray(product.generated.tags) && product.generated.tags.length);
    assert.equal(product.ai.provider, "mock");
    assert.ok(product.ai.prompts["full"] || Object.keys(product.ai.prompts).length, "the prompt version is recorded");
    // The customer's own input is preserved next to the generated result.
    assert.equal(product.input.name, "هدفون بی‌سیم");
    assert.equal(product.input.price, 2450000);
  });

  await t.test("job polling returns status without leaking internals", async () => {
    const { data: list } = await asOwner("GET", `/api/ai/products/${draftId}`);
    const jobId = list.product.job.id;

    const { status, data } = await asOwner("GET", `/api/ai/jobs/${jobId}`);
    assert.equal(status, 200);
    assert.equal(data.job.status, "succeeded");
    assert.equal("locked_by" in data.job, false);
    assert.equal("payload" in data.job, false, "job payload stays server-side");

    const stolen = await asIntruder("GET", `/api/ai/jobs/${jobId}`);
    assert.equal(stolen.status, 403);
  });

  await t.test("another customer cannot read or edit the draft", async () => {
    assert.equal((await asIntruder("GET", `/api/ai/products/${draftId}`)).status, 403);
    assert.equal((await asIntruder("PATCH", `/api/ai/products/${draftId}`, { title: "ربوده شد" })).status, 403);
    assert.equal((await asIntruder("POST", `/api/ai/products/${draftId}/approve`)).status, 403);
    assert.equal((await asIntruder("POST", `/api/ai/products/${draftId}/publish`)).status, 403);
  });

  await t.test("uploading an image validates the bytes", async () => {
    const png = await makePng(500, 400);
    const { status, data } = await asOwner("POST", `/api/ai/products/${draftId}/images`, png, { "content-type": "image/png" });
    assert.equal(status, 201);
    assert.equal(data.image.width, 500);

    // A PHP payload announced as an image is refused.
    const evil = await asOwner(
      "POST", `/api/ai/products/${draftId}/images`,
      Buffer.from("<?php system($_GET[0]); ?>"), { "content-type": "image/png" },
    );
    assert.equal(evil.status, 400);
    assert.equal(evil.data.error_code, "IMAGE_VALIDATION_ERROR");

    // An unsupported type never reaches the handler.
    const wrongType = await fetch(`${server.baseUrl}/api/ai/products/${draftId}/images`, {
      method: "POST",
      headers: { Authorization: `Bearer ${owner.token}`, "content-type": "application/x-php" },
      body: Buffer.from("<?php ?>"),
    });
    assert.ok([400, 415].includes(wrongType.status));
  });

  await t.test("an oversized upload is rejected", async () => {
    const huge = Buffer.concat([await makePng(200, 200), Buffer.alloc(9 * 1024 * 1024)]);
    const response = await fetch(`${server.baseUrl}/api/ai/products/${draftId}/images`, {
      method: "POST",
      headers: { Authorization: `Bearer ${owner.token}`, "content-type": "image/png" },
      body: huge,
    });
    assert.ok([400, 413].includes(response.status), `unexpected ${response.status}`);
  });

  await t.test("editing locks a field, and targeted regeneration respects it", async () => {
    const edit = await asOwner("PATCH", `/api/ai/products/${draftId}`, { title: "هدفون بی‌سیم حرفه‌ای" });
    assert.equal(edit.status, 200);
    assert.deepEqual(edit.data.edited_fields, ["title"]);

    const regenerate = await asOwner("POST", `/api/ai/products/${draftId}/regenerate`, { section: "seo" });
    assert.equal(regenerate.status, 202);
    assert.equal(regenerate.data.started, true);

    await waitForJob(regenerate.data.job.id, ["succeeded", "failed"]);
    const { data: after } = await asOwner("GET", `/api/ai/products/${draftId}`);
    assert.equal(after.product.generated.title, "هدفون بی‌سیم حرفه‌ای", "the edited title is preserved");
    assert.ok(after.product.locked_fields.includes("title"));

    const unknown = await asOwner("POST", `/api/ai/products/${draftId}/regenerate`, { section: "everything" });
    assert.equal(unknown.status, 400);
  });

  await t.test("version history is exposed to the customer", async () => {
    const { data } = await asOwner("GET", `/api/ai/products/${draftId}/versions`);
    assert.ok(data.versions.length >= 3);
    assert.ok(data.versions.some((version) => version.source === "user_edit"));
    assert.ok(data.versions.some((version) => version.source === "ai_generation"));
  });

  await t.test("publishing requires approval and a WooCommerce connection", async () => {
    const tooEarly = await asOwner("POST", `/api/ai/products/${draftId}/publish`);
    assert.equal(tooEarly.status, 409);

    const approved = await asOwner("POST", `/api/ai/products/${draftId}/approve`);
    assert.equal(approved.status, 200);
    assert.equal(approved.data.product.status, "approved");

    const noConnection = await asOwner("POST", `/api/ai/products/${draftId}/publish`);
    assert.equal(noConnection.status, 400);
    assert.equal(noConnection.data.error_code, "WORDPRESS_AUTH_ERROR");
  });

  await t.test("saving a WooCommerce connection tests it and hides the secret", async () => {
    const { status, data } = await asOwner("POST", `/api/sites/${owner.site.id}/woocommerce`, {
      base_url: store.baseUrl,
      consumer_key: "ck_api_key",
      consumer_secret: "cs_api_secret",
      wp_username: "editor",
      wp_app_password: "app pass",
    });
    assert.equal(status, 200);
    assert.equal(data.test.ok, true);
    assert.equal("consumer_secret" in data.connection, false);
    assert.ok(data.connection.consumer_key_hint.includes("•"));

    const stolen = await asIntruder("GET", `/api/sites/${owner.site.id}/woocommerce`);
    assert.equal(stolen.status, 403);
  });

  await t.test("store taxonomy is readable for the review UI", async () => {
    const categories = await asOwner("GET", `/api/sites/${owner.site.id}/woocommerce/categories`);
    assert.equal(categories.status, 200);
    assert.ok(categories.data.categories.some((category) => category.name === "موبایل"));
    const tags = await asOwner("GET", `/api/sites/${owner.site.id}/woocommerce/tags`);
    assert.ok(Array.isArray(tags.data.tags));
  });

  await t.test("publishing is idempotent across duplicate requests", async () => {
    const before = store.productCount();

    // Two publish requests fired together must not create two products.
    const [first, second] = await Promise.all([
      asOwner("POST", `/api/ai/products/${draftId}/publish`),
      asOwner("POST", `/api/ai/products/${draftId}/publish`),
    ]);
    assert.ok([202, 200].includes(first.status));
    assert.ok([202, 200].includes(second.status));
    assert.ok([first.data.started, second.data.started].filter(Boolean).length <= 1, "only one publish job starts");

    const product = await waitForStatus(draftId, ["published", "publishing_failed"]);
    assert.equal(product.status, "published");
    assert.ok(product.wordpress.product_id);
    assert.ok(product.wordpress.permalink);
    assert.equal(store.productCount(), before + 1);

    // A third request after publication reports the existing product.
    const again = await asOwner("POST", `/api/ai/products/${draftId}/publish`);
    assert.equal(again.status, 200);
    assert.equal(again.data.already_published, true);
    assert.equal(store.productCount(), before + 1);
  });

  await t.test("a published product cannot be cancelled", async () => {
    const { status, data } = await asOwner("POST", `/api/ai/products/${draftId}/cancel`);
    assert.equal(status, 409);
    assert.equal(data.error_code, "CONFLICT");
  });

  await t.test("site automation settings are readable and writable by the owner only", async () => {
    const defaults = await asOwner("GET", `/api/sites/${owner.site.id}/product-settings`);
    assert.equal(defaults.data.settings.require_manual_approval, true);
    assert.equal(defaults.data.settings.auto_publish, false);

    const saved = await asOwner("PUT", `/api/sites/${owner.site.id}/product-settings`, {
      tone: "دوستانه", auto_generate_tags: false, default_product_status: "publish",
    });
    assert.equal(saved.data.settings.tone, "دوستانه");
    assert.equal(saved.data.settings.auto_generate_tags, false);
    assert.equal(saved.data.settings.default_product_status, "publish");

    // An invalid status falls back to a safe value rather than being stored.
    const invalid = await asOwner("PUT", `/api/sites/${owner.site.id}/product-settings`, {
      default_product_status: "delete-everything",
    });
    assert.equal(invalid.data.settings.default_product_status, "draft");

    assert.equal((await asIntruder("PUT", `/api/sites/${owner.site.id}/product-settings`, { auto_publish: true })).status, 403);
  });

  await t.test("usage reflects what was actually spent", async () => {
    const { data } = await asOwner("GET", "/api/ai/usage");
    assert.ok(data.usage.products.used >= 2, "generation and regeneration both cost a credit");
    assert.equal(data.usage.products.limit, 20);
    assert.ok(data.usage.products.remaining < 20);
  });

  await t.test("exhausted quota is refused with a clear code", async () => {
    await withPool((pool) => pool.query(
      `INSERT INTO ai_usage(user_id, operation, units, status, period)
       SELECT $1, 'product_generation', 20, 'committed', to_char(NOW() AT TIME ZONE 'Asia/Tehran', 'YYYY-MM')`,
      [owner.user.id],
    ));

    const { status, data } = await asOwner("POST", "/api/ai/products", {
      site_id: owner.site.id, input: { name: "بیش از سهمیه" },
    });
    assert.equal(status, 402);
    assert.equal(data.error_code, "AI_QUOTA_ERROR");
    assert.match(data.error, /سهمیه/);
  });

  await t.test("existing customer API endpoints are unchanged", async () => {
    const me = await asOwner("GET", "/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.success, true);
    assert.ok(me.data.user.id);
    assert.equal("subscription" in me.data, true);

    const sites = await asOwner("GET", "/api/sites");
    assert.equal(sites.status, 200);
    assert.ok(Array.isArray(sites.data.sites));
    assert.equal(sites.data.sites[0].id, owner.site.id);

    const health = await fetch(`${server.baseUrl}/api/health`);
    assert.equal((await health.json()).success, true);
  });

  await t.test("readiness reports AI as an optional dependency", async () => {
    const response = await fetch(`${server.baseUrl}/health/ready`);
    const data = await response.json();
    assert.equal(data.checks.ai.enabled, true);
    assert.equal(data.checks.ai.required, false);
    assert.equal(data.checks.ai.configured, true);
  });

  await t.test("no credential or key appears in the server log stream", () => {
    const logs = server.logs.join("");
    assert.doesNotMatch(logs, /cs_api_secret/, "WooCommerce secret must never be logged");
    assert.doesNotMatch(logs, /ck_api_key/);
    assert.doesNotMatch(logs, /app pass/);
  });
});
